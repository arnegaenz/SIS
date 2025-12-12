import fs from 'fs';

const keyFile = './secrets/ga-service-account.json';
const creds = JSON.parse(fs.readFileSync(keyFile, 'utf8'));

console.log('Service Account Details:');
console.log('Email:', creds.client_email);
console.log('Project:', creds.project_id);
console.log('Key ID:', creds.private_key_id);
console.log('');

// Try to manually verify the key format
const key = creds.private_key;
const lines = key.split('\n');
console.log('Private key format:');
console.log('- First line:', lines[0]);
console.log('- Last line:', lines[lines.length - 1]);
console.log('- Total lines:', lines.length);
console.log('- Contains BEGIN:', key.includes('BEGIN PRIVATE KEY'));
console.log('- Contains END:', key.includes('END PRIVATE KEY'));

// Check if key looks valid
const keyBody = key.replace(/-----BEGIN PRIVATE KEY-----/, '')
                   .replace(/-----END PRIVATE KEY-----/, '')
                   .replace(/\s/g, '');
console.log('- Base64 body length:', keyBody.length);
console.log('- Looks like valid base64:', /^[A-Za-z0-9+/=]+$/.test(keyBody));
