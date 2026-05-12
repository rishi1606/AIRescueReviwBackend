const nodemailer = require("nodemailer");

async function main() {
  // Generate test SMTP service account from ethereal.email
  // Only needed if you don't have a real mail account for testing
  let testAccount = await nodemailer.createTestAccount();

  console.log("=========================================");
  console.log("     INSTANT EMAIL CREDENTIALS           ");
  console.log("=========================================");
  console.log("EMAIL_HOST=smtp.ethereal.email");
  console.log("EMAIL_PORT=587");
  console.log(`EMAIL_USER=${testAccount.user}`);
  console.log(`EMAIL_PASS=${testAccount.pass}`);
  console.log("=========================================");
  console.log("COPY THESE INTO YOUR .env FILE");
  console.log("=========================================");
}

main().catch(console.error);
