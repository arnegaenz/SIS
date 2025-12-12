import { google } from 'googleapis';
import { logGaCredentialFile } from './log-ga-credentials.mjs';

const keyFile = './secrets/ga-service-account.json';

async function testAuth() {
  try {
    logGaCredentialFile(keyFile, 'Service Account key');
    console.log('Creating auth client...');
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
    
    console.log('Getting access token...');
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    
    console.log('✓ Authentication successful!');
    console.log('Token type:', typeof token);
    console.log('Has token:', !!token.token);
    return true;
  } catch (err) {
    console.error('✗ Authentication failed:', err.message);
    if (err.response?.data) {
      console.error('Response data:', JSON.stringify(err.response.data, null, 2));
    }
    return false;
  }
}

testAuth();
