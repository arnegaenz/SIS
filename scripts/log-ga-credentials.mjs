import fs from 'fs';

export function logGaCredentialFile(filePath, label) {
  try {
    const stats = fs.statSync(filePath);
    console.log(
      `[GA LOG] ${label}: ${filePath} (size ${stats.size} bytes, modified ${stats.mtime.toISOString()})`
    );
  } catch (err) {
    console.warn(`[GA LOG] ${label}: ${filePath} is not accessible (${err.message}).`);
  }
}
