# Verify Android Keystore Action

A GitHub Action to verify the validity of an Android Keystore file, its password, and a specific key alias. This action is designed to "fail fast" in your CI/CD pipeline if your signing secrets are incorrect.

## Features
- ✅ Verifies Keystore file existence (from path or Base64 secret).
- ✅ Verifies Keystore password.
- ✅ Verifies Alias existence.
- ✅ Verifies Alias password.

## Usage

### Inputs

| Input | Description | Required | Satus |
|---|---|---|---|
| `keystore-path` | Path to the `.keystore` or `.jks` file. | No* | One of `path` or `base64` is required. |
| `keystore-base64` | Base64 encoded content of the keystore file. | No* | One of `path` or `base64` is required. |
| `keystore-password` | Password for the keystore. | **Yes** | |
| `alias-name` | Alias name to verify. | **Yes** | |
| `alias-password` | Password for the specific alias key. | **Yes** | |

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

## License
MIT
