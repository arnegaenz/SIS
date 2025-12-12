import { google } from 'googleapis';
import { logGaCredentialFile } from './log-ga-credentials.mjs';

async function testBothAccounts() {
  const accounts = [
    { name: 'Main Account', file: './secrets/ga-service-account.json' },
    { name: 'Test Account', file: './secrets/ga-test.json' }
  ];
  
  for (const account of accounts) {
    console.log(`\nTesting ${account.name} (${account.file})...`);
    logGaCredentialFile(account.file, account.name);
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: account.file,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      });
      
      const client = await auth.getClient();
      const token = await client.getAccessToken();
      
      console.log(`✓ ${account.name} authentication successful!`);
    } catch (err) {
      console.error(`✗ ${account.name} failed:`, err.message);
    }
  }
}

testBothAccounts();
