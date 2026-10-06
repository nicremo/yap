#!/usr/bin/env bash
# Creates a self-signed code signing identity named "Yap Self-Signed" in the
# login keychain. Run it once on the Mac that builds Yap.
#
# Why: macOS ties privacy permissions to the code signature. Without a stable
# signature every build counts as a new app, so Accessibility, Input
# Monitoring and Microphone look granted in System Settings after an update
# but are not honoured. Builds signed with this identity keep them.
#
# It does not replace an Apple Developer ID: Gatekeeper still asks users to
# clear the quarantine flag of a downloaded build (see README).
set -euo pipefail

NAME="Yap Self-Signed"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is for macOS." >&2
  exit 1
fi

if security find-identity -p codesigning | grep -q "\"${NAME}\""; then
  echo "\"${NAME}\" already exists. Nothing to do."
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

cat > "${WORK}/openssl.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions = codesign
prompt = no

[ dn ]
CN = ${NAME}

[ codesign ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -config "${WORK}/openssl.cnf" \
  -keyout "${WORK}/key.pem" -out "${WORK}/cert.pem" >/dev/null 2>&1

# macOS' security tool only reads PKCS#12 files with the old algorithms
# (3DES and a SHA-1 MAC). LibreSSL, the system openssl, writes those by
# default. OpenSSL 3 and 4 (Homebrew is often first in PATH) default to AES
# and SHA-256, which security rejects with "MAC verification failed". Naming
# the algorithms works with all of them, no version check needed.
PASSWORD="yap-$(date +%s)"
openssl pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -inkey "${WORK}/key.pem" -in "${WORK}/cert.pem" \
  -name "${NAME}" -out "${WORK}/identity.p12" -passout "pass:${PASSWORD}"

# -T lets codesign use the key without a keychain prompt on every build.
security import "${WORK}/identity.p12" -k "${KEYCHAIN}" -P "${PASSWORD}" -T /usr/bin/codesign >/dev/null

echo "Created \"${NAME}\"."
echo "npm run package:mac now signs with it, and macOS keeps Yap's permissions across updates."
