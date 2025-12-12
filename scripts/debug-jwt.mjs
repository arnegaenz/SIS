import fs from 'fs';
import { JWT } from 'google-auth-library';
import { logGaCredentialFile } from './log-ga-credentials.mjs';

const keyFile = './secrets/ga-service-account.json';
logGaCredentialFile(keyFile, 'Service Account key');
const creds = JSON.parse(fs.readFileSync(keyFile, 'utf8'));

console.log('Creating JWT directly...');
console.log('Email:', creds.client_email);
console.log('Scopes:', ['https://www.googleapis.com/auth/analytics.readonly']);

const client = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
});

console.log('\nAttempting to get access token...');

client.authorize((err, tokens) => {
  if (err) {
    console.error('\n✗ JWT Authorization failed:');
    console.error('Error:', err.message);
    if (err.response?.data) {
      console.error('Response:', JSON.stringify(err.response.data, null, 2));
    }
    console.error('\nFull error:', err);
    process.exit(1);
  }
  
  console.log('\n✓ JWT Authorization successful!');
  console.log('Token type:', tokens.token_type);
  console.log('Expires in:', tokens.expiry_date);
  process.exit(0);
});
