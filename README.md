# Verify Android Keystore Action

A GitHub Action to verify the validity of an Android Keystore file, its password, and a specific key alias. This action is designed to "fail fast" in your CI/CD pipeline if your signing secrets are incorrect.

## Features
- ✅ Detects keystore type (PKCS12, JKS, etc.)
- ✅ Verifies Keystore file existence (from path or Base64 secret).
- ✅ Verifies Keystore password.
- ✅ Verifies Alias existence.
- ✅ Verifies Alias password (with PKCS12-aware validation to prevent false positives).

## Usage

### Inputs

| Input | Description | Required | Status |
|---|---|---|---|
| `keystore-path` | Path to the `.keystore` or `.jks` file. | No* | One of `path` or `base64` is required. |
| `keystore-base64` | Base64 encoded content of the keystore file. | No* | One of `path` or `base64` is required. |
| `keystore-password` | Password for the keystore. | **Yes** | |
| `alias-name` | Alias name to verify. | **Yes** | |
| `alias-password` | Password for the alias. | **Yes** | For PKCS12, must match `keystore-password`. |

### Example Workflow

```yaml
name: Build Android
on: push

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Verify Keystore
        uses: Appegy/verify-keystore-action@v1
        with:
          keystore-base64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          keystore-password: ${{ secrets.ANDROID_KEYSTORE_PASS }}
          alias-name: ${{ secrets.ANDROID_KEYALIAS_NAME }}
          alias-password: ${{ secrets.ANDROID_KEYALIAS_PASS }}
          
      - name: Build with Gradle
        run: ./gradlew assembleRelease
```

> [!NOTE]
> For **PKCS12** keystores, `keystore-password` and `alias-password` must be **identical**. Use the same secret for both.
>
> For **JKS** keystores, passwords can be the same or different.

### Using a File Path

If you already have the keystore file on disk (e.g., checked out or downloaded):

```yaml
      - name: Verify Keystore
        uses: Appegy/verify-keystore-action@v1
        with:
          keystore-path: './app/release.keystore'
          keystore-password: ${{ secrets.ANDROID_KEYSTORE_PASS }}
          alias-name: ${{ secrets.ANDROID_KEYALIAS_NAME }}
          alias-password: ${{ secrets.ANDROID_KEYALIAS_PASS }}
```

## Keystore Types: PKCS12 vs JKS

This action automatically detects your keystore type and applies appropriate validation.

### PKCS12 Keystores

**Important:** PKCS12 keystores **require identical passwords** for both the keystore and the key alias.

If your `keystore-password` and `alias-password` are different, the action will **fail** with a clear error message. This matches the behavior of Android Gradle Plugin (AGP) during actual signing.

#### Why This Matters

The Java `keytool` utility silently ignores the `-keypass` parameter for PKCS12 keystores, which can lead to false positives in verification. This action now correctly validates that:
1. Both passwords are identical
2. The private key can actually be decrypted and accessed

#### Migration to JKS (if needed)

If you need separate passwords for store and key, convert your keystore to JKS format:

```bash
keytool -importkeystore \
  -srckeystore your-keystore.p12 \
  -srcstoretype PKCS12 \
  -destkeystore your-keystore.jks \
  -deststoretype JKS
```

### JKS Keystores

JKS keystores support different passwords for the keystore and individual key aliases. The action validates both independently.

## Troubleshooting

### Error: "PKCS12 keystores do not support different store and key passwords"

**Cause:** Your `keystore-password` and `alias-password` secrets have different values, but your keystore is PKCS12 format.

**Solution:**
1. **Option A:** Update your GitHub secrets so both passwords are identical (use the correct password for your PKCS12 keystore)
2. **Option B:** Convert your keystore to JKS format (see migration command above)

### How to Check Your Keystore Type

```bash
keytool -list -v -keystore your-keystore.jks -storepass YOUR_PASSWORD | grep "Keystore type"
```

### Common Issues

- **Wrong password:** Double-check your GitHub secrets for typos
- **Different passwords for PKCS12:** Use the same password for both `keystore-password` and `alias-password`
- **Alias not found:** Verify the alias name exists in your keystore
- **Not a PrivateKeyEntry:** The alias must contain a private key, not just a certificate

## Development

### Running Tests

The CI workflow includes comprehensive tests:

**Positive Tests** (should pass):
- JKS keystore with file path and base64
- PKCS12 keystore with matching passwords
- Different store/key passwords for JKS

**Negative Tests** (should fail):
- PKCS12 with different passwords  
- Wrong store password
- Wrong alias name
- Wrong key password for JKS

Tests use `continue-on-error: true` with outcome verification to ensure the action correctly fails for invalid credentials.

### Building

```bash
npm ci
npm run build
```

The `dist/` directory must be committed as it contains the bundled action code.



## License
MIT
