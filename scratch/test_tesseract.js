import Tesseract from 'tesseract.js';
import fs from 'fs';

console.log('Testing Tesseract in ES Module...');

try {
  // Create a 1x1 transparent PNG buffer
  const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const { data } = await Tesseract.recognize(buf, 'eng', { logger: () => {} });
  console.log('Tesseract success, text:', data.text);
} catch (err) {
  console.error('Tesseract failed with:', err);
}
