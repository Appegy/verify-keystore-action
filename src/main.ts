import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface KeystoreInfo {
  type: 'PKCS12' | 'JKS' | 'UNKNOWN';
  detectedType: string;
}

/**
 * Detects the type of keystore (PKCS12, JKS, etc.) by parsing keytool output.
 */
async function detectKeystoreType(
  keystorePath: string,
  keystorePassword: string
): Promise<KeystoreInfo> {
  let output = '';

  try {
    await exec.exec('keytool', ['-list', '-v', '-keystore', keystorePath, '-storepass', keystorePassword], {
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        }
      }
    });
  } catch (error: any) {
    throw new Error(`Failed to detect keystore type: ${error.message}`);
  }

  // Parse the output to find "Keystore type:" line
  const typeMatch = output.match(/Keystore type:\s*(\S+)/i);
  if (!typeMatch) {
    return { type: 'UNKNOWN', detectedType: 'unknown' };
  }

  const detectedType = typeMatch[1].toUpperCase();

  if (detectedType === 'PKCS12') {
    return { type: 'PKCS12', detectedType };
  } else if (detectedType === 'JKS') {
    return { type: 'JKS', detectedType };
  } else {
    return { type: 'UNKNOWN', detectedType };
  }
}

/**
 * Verifies that the private key can actually be accessed with the given password.
 * This is critical for PKCS12 keystores where -keypass is ignored.
 */
async function verifyPrivateKeyAccess(
  keystorePath: string,
  keystorePassword: string,
  aliasName: string,
  aliasPassword: string,
  keystoreInfo: KeystoreInfo
): Promise<void> {
  if (keystoreInfo.type === 'PKCS12') {
    // For PKCS12, the store password and key password MUST be the same
    if (keystorePassword !== aliasPassword) {
      throw new Error(
        `PKCS12 keystores do not support different store and key passwords.\n` +
        `Your keystore-password and alias-password must be identical.\n` +
        `Please update your secrets to use the same password for both, or convert your keystore to JKS format.\n` +
        `\n` +
        `Current situation: You have different passwords configured, which will cause Gradle/AGP signing to fail.\n` +
        `\n` +
        `To fix:\n` +
        `  1. Use the same password for both keystore-password and alias-password, OR\n` +
        `  2. Convert to JKS: keytool -importkeystore -srckeystore your.p12 -destkeystore your.jks -deststoretype JKS`
      );
    }

    // Now verify we can actually access the private key by attempting a real operation
    // We'll use -importkeystore to a temporary location which requires decrypting the private key
    const tempDir = os.tmpdir();
    const tempKeystore = path.join(tempDir, `temp-verify-${Date.now()}.p12`);

    try {
      await exec.exec('keytool', [
        '-importkeystore',
        '-srckeystore', keystorePath,
        '-srcstorepass', keystorePassword,
        '-srcalias', aliasName,
        '-destkeystore', tempKeystore,
        '-deststorepass', keystorePassword,
        '-destkeypass', keystorePassword,
        '-deststoretype', 'PKCS12',
        '-noprompt'
      ], {
        silent: true
      });

      // Clean up temporary keystore
      if (fs.existsSync(tempKeystore)) {
        fs.unlinkSync(tempKeystore);
      }
    } catch (error: any) {
      // Clean up on error too
      if (fs.existsSync(tempKeystore)) {
        fs.unlinkSync(tempKeystore);
      }
      throw new Error(`Failed to access private key for alias '${aliasName}': ${error.message}`);
    }
  } else {
    // For JKS and other types, use the CSR approach which properly tests key password
    try {
      await exec.exec('keytool', [
        '-certreq',
        '-alias', aliasName,
        '-keypass', aliasPassword,
        '-keystore', keystorePath,
        '-storepass', keystorePassword
      ], {
        silent: true
      });
    } catch (error: any) {
      throw error;
    }
  }
}

async function run(): Promise<void> {
  let tempKeystorePath = '';

  try {
    const keystorePathInput = core.getInput('keystore-path');
    const keystoreBase64 = core.getInput('keystore-base64');
    const keystorePassword = core.getInput('keystore-password', { required: true });
    const aliasName = core.getInput('alias-name', { required: true });
    const aliasPassword = core.getInput('alias-password', { required: true });

    let keystorePath = '';

    console.log('----------------------------------------');
    console.log('Verifying Keystore...');

    // 1. Determine Keystore File
    if (keystorePathInput) {
      keystorePath = keystorePathInput;
      console.log(`Using provided keystore path: ${keystorePath}`);
    } else if (keystoreBase64) {
      console.log('Decoding Base64 keystore to temporary file...');
      const tempDir = os.tmpdir();
      tempKeystorePath = path.join(tempDir, 'temp.keystore');
      const buffer = Buffer.from(keystoreBase64, 'base64');
      fs.writeFileSync(tempKeystorePath, buffer);
      keystorePath = tempKeystorePath;
      console.log(`Created temporary keystore at: ${keystorePath}`);
    } else {
      throw new Error("Either 'keystore-path' or 'keystore-base64' must be provided.");
    }

    // 2. Check file existence
    if (!fs.existsSync(keystorePath)) {
      throw new Error(`CRITICAL ERROR: Keystore file NOT found at: ${keystorePath}`);
    }
    console.log('✅ Keystore file found.');

    // 3. Verify Keystore Password
    console.log('Test 1: Checking Store Password...');
    try {
      // Use silent: true to prevent printing the command which contains the password
      // We manually capture output if needed, but exec throws on non-zero exit code
      await exec.exec('keytool', ['-list', '-keystore', keystorePath, '-storepass', keystorePassword], {
        silent: true,
        listeners: {
          // We can optionally capture stdout/stderr here if we want to print it on failure
          // but default error behavior of verifying exit code is usually enough for "pass/fail"
        }
      });
      console.log('✅ Keystore password OK.');
    } catch (error: any) {
      console.error('❌ KEYSTORE PASSWORD ERROR.');
      console.error('Possible reasons:');
      console.error('1. The secret keystore-password contains a typo.');
      console.error('2. The keystore file is corrupted.');
      throw new Error(`Keystore verification failed: ${error.message}`);
    }

    // 4. Detect Keystore Type
    console.log('Test 2: Detecting keystore type...');
    let keystoreInfo: KeystoreInfo;
    try {
      keystoreInfo = await detectKeystoreType(keystorePath, keystorePassword);
      console.log(`✅ Keystore type detected: ${keystoreInfo.detectedType}`);

      if (keystoreInfo.type === 'PKCS12') {
        console.log('ℹ️  PKCS12 keystores require identical store and key passwords.');
      } else if (keystoreInfo.type === 'JKS') {
        console.log('ℹ️  JKS keystore supports separate store and key passwords.');
      } else {
        console.log(`⚠️  Warning: Unknown keystore type '${keystoreInfo.detectedType}'. Verification may not be accurate.`);
      }
    } catch (error: any) {
      throw new Error(`Failed to detect keystore type: ${error.message}`);
    }

    // 5. Verify Alias Existence
    console.log(`Test 3: Checking Alias '${aliasName}'...`);
    try {
      await exec.exec('keytool', ['-list', '-keystore', keystorePath, '-storepass', keystorePassword, '-alias', aliasName], {
        silent: true
      });
      console.log(`✅ Alias '${aliasName}' found.`);
    } catch (error: any) {
      console.error(`❌ ALIAS ERROR: Alias '${aliasName}' NOT FOUND in keystore.`);
      // List available aliases for debugging
      console.log('Available aliases:');
      try {
        await exec.exec('keytool', ['-list', '-keystore', keystorePath, '-storepass', keystorePassword], { silent: false });
      } catch (e) { /* ignore secondary error */ }
      throw new Error(`Alias verification failed: ${error.message}`);
    }

    // 6. Verify Alias Password (Type-Aware)
    console.log(`Test 4: Verifying password for Alias '${aliasName}'...`);
    try {
      await verifyPrivateKeyAccess(keystorePath, keystorePassword, aliasName, aliasPassword, keystoreInfo);
      console.log('✅ Alias password verified. Private key is accessible.');
    } catch (error: any) {
      console.error(`❌ ALIAS PASSWORD ERROR for '${aliasName}'.`);
      console.error('Error details:');
      console.error(error.message);

      if (keystoreInfo.type === 'PKCS12') {
        console.error('\nFor PKCS12 keystores:');
        console.error('- Store password and key password MUST be identical');
        console.error('- If you need different passwords, convert to JKS format');
      } else {
        console.error('\nPossible reasons:');
        console.error('1. The alias-password contains a typo.');
        console.error('2. The alias is not a PrivateKeyEntry (it might be just a certificate).');
      }
      throw new Error(`Alias password verification failed: ${error.message}`);
    }

    console.log('----------------------------------------');
    console.log('🎉 All checks passed successfully!');

  } catch (error: any) {
    core.setFailed(error.message);
  } finally {
    if (tempKeystorePath && fs.existsSync(tempKeystorePath)) {
      console.log('Cleaning up temporary keystore file...');
      try {
        await io.rmRF(tempKeystorePath);
      } catch (e) {
        console.warn(`Failed to verify cleanup: ${e}`);
      }
    }
  }
}

run();
