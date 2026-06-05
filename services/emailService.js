const nodemailer = require('nodemailer');

// Email configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Verify email configuration
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Email configuration error:', error);
        console.error('   Please check your SMTP_USER and SMTP_PASS in .env');
    } else {
        console.log('✅ Email service ready!');
    }
});

// Send password reset email
async function sendPasswordResetEmail(to, resetCode, username) {
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?code=${resetCode}&email=${encodeURIComponent(to)}`;
    
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Password Reset - MOREVA ENERGY</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    line-height: 1.6;
                    color: #1e293b;
                    background-color: #f1f5f9;
                    margin: 0;
                    padding: 20px;
                }
                .container {
                    max-width: 560px;
                    margin: 0 auto;
                    background: white;
                    border-radius: 20px;
                    overflow: hidden;
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
                }
                .header {
                    background: linear-gradient(135deg, #1e3a8a, #dc2626);
                    padding: 40px 30px;
                    text-align: center;
                }
                .header h1 {
                    color: white;
                    margin: 0;
                    font-size: 28px;
                    font-weight: 800;
                }
                .header p {
                    color: rgba(255,255,255,0.9);
                    margin: 8px 0 0;
                }
                .content {
                    padding: 40px 30px;
                }
                .greeting {
                    font-size: 18px;
                    font-weight: 600;
                    margin-bottom: 20px;
                    color: #0f172a;
                }
                .reset-code {
                    background: #f8fafc;
                    border: 2px solid #e2e8f0;
                    padding: 20px;
                    text-align: center;
                    font-size: 36px;
                    font-weight: 800;
                    letter-spacing: 8px;
                    border-radius: 16px;
                    margin: 25px 0;
                    font-family: 'Courier New', monospace;
                    color: #1e3a8a;
                }
                .button {
                    display: inline-block;
                    padding: 12px 32px;
                    background: linear-gradient(135deg, #1e3a8a, #dc2626);
                    color: white;
                    text-decoration: none;
                    border-radius: 40px;
                    font-weight: 600;
                    margin: 20px 0;
                }
                .warning-box {
                    background: #fef3c7;
                    border-left: 4px solid #f59e0b;
                    padding: 16px;
                    border-radius: 12px;
                    margin: 25px 0;
                    font-size: 14px;
                }
                .footer {
                    background: #f8fafc;
                    padding: 24px;
                    text-align: center;
                    font-size: 12px;
                    color: #64748b;
                    border-top: 1px solid #e2e8f0;
                }
                .badge {
                    display: inline-block;
                    background: #e2e8f0;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    color: #475569;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>⛽ MOREVA ENERGY</h1>
                    <p>Enterprise Fuel Management System</p>
                </div>
                <div class="content">
                    <div class="greeting">
                        Hello ${username || 'Valued User'}!
                    </div>
                    
                    <p>We received a request to reset your password for your MOREVA ENERGY account.</p>
                    
                    <div style="text-align: center;">
                        <div class="reset-code">
                            ${resetCode}
                        </div>
                    </div>
                    
                    <p>Use this <strong>6-digit verification code</strong> to reset your password. The code will expire in <strong>1 hour</strong>.</p>
                    
                    <div class="warning-box">
                        <strong>⚠️ Security Notice</strong><br>
                        If you didn't request this password reset, please ignore this email. Your account is secure.
                    </div>
                    
                    <div style="text-align: center;">
                        <a href="${resetLink}" class="button">Reset Password →</a>
                    </div>
                    
                    <p style="font-size: 13px; color: #64748b; margin-top: 30px;">
                        For security reasons, never share this code with anyone. Our team will never ask for your verification code.
                    </p>
                </div>
                <div class="footer">
                    <p>© 2026 MOREVA ENERGY LTD. All rights reserved.</p>
                    <p class="badge">Secure Password Reset Request</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    const textContent = `
MOREVA ENERGY - Password Reset Request

Hello ${username || 'User'},

You requested to reset your password. Use the following verification code:

${resetCode}

This code will expire in 1 hour.

If you didn't request this, please ignore this email.

Security Notice: Never share this code with anyone.

---
MOREVA ENERGY LTD
Enterprise Fuel Management System
    `;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'MOREVA ENERGY <noreply@moreva.com>',
        to: to,
        subject: `${process.env.EMAIL_SUBJECT_PREFIX || '[MOREVA ENERGY]'} Password Reset Request`,
        text: textContent,
        html: htmlContent
    };
    
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`📧 Password reset email sent to: ${to}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Failed to send email:', error);
        return { success: false, error: error.message };
    }
}

// Send welcome email on signup
async function sendWelcomeEmail(to, username, requiresApproval = true) {
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Welcome to MOREVA ENERGY</title>
        </head>
        <body style="font-family: Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden;">
                <div style="background: linear-gradient(135deg, #1e3a8a, #dc2626); padding: 30px; text-align: center;">
                    <h1 style="color: white;">⛽ Welcome to MOREVA ENERGY!</h1>
                </div>
                <div style="padding: 30px;">
                    <h2>Hello ${username}!</h2>
                    <p>Thank you for registering with MOREVA ENERGY Fuel Management System.</p>
                    ${requiresApproval ? `
                    <div style="background: #fff3cd; padding: 16px; border-radius: 8px; margin: 20px 0;">
                        <strong>📋 Account Pending Approval</strong><br>
                        Your account has been created and is pending admin approval. You will receive another email once your account is activated.
                    </div>
                    ` : `
                    <div style="background: #d4edda; padding: 16px; border-radius: 8px; margin: 20px 0;">
                        <strong>✅ Account Activated!</strong><br>
                        Your account has been approved. You can now log in to the system.
                    </div>
                    `}
                    <p>Best regards,<br>
                    <strong>MOREVA ENERGY Team</strong></p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: `Welcome to MOREVA ENERGY - ${requiresApproval ? 'Pending Approval' : 'Account Activated'}`,
        html: htmlContent
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Welcome email sent to: ${to}`);
        return { success: true };
    } catch (error) {
        console.error('Failed to send welcome email:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendPasswordResetEmail,
    sendWelcomeEmail
};
// Send account approval email
async function sendAccountApprovalEmail(to, username) {
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}`;
    
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Account Approved - MOREVA ENERGY</title>
        </head>
        <body style="font-family: Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden;">
                <div style="background: linear-gradient(135deg, #1e3a8a, #dc2626); padding: 30px; text-align: center;">
                    <h1 style="color: white;">✅ Account Approved!</h1>
                </div>
                <div style="padding: 30px;">
                    <h2>Hello ${username}!</h2>
                    <p>Great news! Your MOREVA ENERGY account has been approved by the administrator.</p>
                    <p>You can now log in to the Fuel Management System using your credentials.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${loginUrl}" style="background: linear-gradient(135deg, #1e3a8a, #dc2626); color: white; padding: 12px 32px; text-decoration: none; border-radius: 25px; display: inline-block;">Login to Your Account →</a>
                    </div>
                    <p>If you have any questions, please contact the system administrator.</p>
                    <p>Best regards,<br><strong>MOREVA ENERGY Team</strong></p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: 'Account Approved - MOREVA ENERGY',
        html: htmlContent
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Approval email sent to: ${to}`);
        return { success: true };
    } catch (error) {
        console.error('Failed to send approval email:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendPasswordResetEmail,
    sendWelcomeEmail,
    sendAccountApprovalEmail
};