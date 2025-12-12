import fs from 'fs';
import crypto from 'crypto';

const keyFile = './secrets/ga-service-account.json';
const content = fs.readFileSync(keyFile, 'utf8');
const creds = JSON.parse(content);

console.log('Checking private key...');
const key = creds.private_key;

// Check for hidden characters
const lines = key.split('\n');
console.log('Number of lines:', lines.length);
console.log('First line bytes:', Buffer.from(lines[0]).toString('hex'));
console.log('First line:', JSON.stringify(lines[0]));

// Try to load the key with Node's crypto
try {
  const privateKey = crypto.createPrivateKey({
    key: key,
    format: 'pem',
    type: 'pkcs8'
  });
  console.log('\n✓ Key is valid PKCS8 format');
  console.log('Key type:', privateKey.asymmetricKeyType);
  console.log('Key size:', privateKey.asymmetricKeyDetails);
} catch (err) {
  console.error('\n✗ Key validation failed:', err.message);
}
