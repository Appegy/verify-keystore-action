import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

    // 4. Verify Alias Existence
    console.log(`Test 2: Checking Alias '${aliasName}'...`);
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

    // 5. Verify Alias Password
    console.log(`Test 3: Checking Password for Alias '${aliasName}'...`);
    try {
      // To verify the key password, we attempt to generate a Certificate Signing Request (CSR).
      // This operation requires the private key password to access the key.
      // It is non-destructive (we just discard the output).
      await exec.exec('keytool', [
        '-certreq',
        '-alias', aliasName,
        '-keypass', aliasPassword,
        '-keystore', keystorePath,
        '-storepass', keystorePassword
      ], {
        silent: true
      });
      console.log('✅ Alias password OK.');
    } catch (error: any) {
      console.error(`❌ ALIAS PASSWORD ERROR for '${aliasName}'.`);
      console.error('Possible reasons:');
      console.error('1. The secret alias-password contains a typo.');
      console.error('2. The alias is not a PrivateKeyEntry (it might be just a certificate).');
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
