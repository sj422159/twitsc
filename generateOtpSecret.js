const speakeasy = require('speakeasy');

// Generate OTP secret
const secret = speakeasy.generateSecret({ length: 20 });

console.log('OTP Secret:', secret.base32);
