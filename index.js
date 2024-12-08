const express = require('express');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises; // Use promises version
const app = express();

// Basic middleware
app.use(express.json());
app.use(express.static('public'));

// Configure multer for memory storage instead of disk
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024 // 25MB limit
    }
}).fields([
    { name: 'excelFile', maxCount: 1 },
    { name: 'attachments', maxCount: 10 }
]);

// Function to read Excel from buffer
async function readExcelBuffer(buffer) {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(worksheet);
    } catch (error) {
        throw new Error('Error reading Excel file: ' + error.message);
    }
}

app.post('/send-emails', async (req, res) => {
    try {
        // Handle file upload
        await new Promise((resolve, reject) => {
            upload(req, res, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Validate request
        if (!req.files?.excelFile?.[0]?.buffer) {
            throw new Error('No Excel file uploaded');
        }

        const { subject, messageTemplate, senderEmail, senderPassword } = req.body;

        // Validate other fields
        if (!subject || !messageTemplate || !senderEmail || !senderPassword) {
            throw new Error('Missing required fields');
        }

        // Read Excel file from buffer
        const recipients = await readExcelBuffer(req.files.excelFile[0].buffer);
        
        if (!recipients || recipients.length === 0) {
            throw new Error('No recipients found in Excel file');
        }

        // Create email transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: senderEmail,
                pass: senderPassword
            }
        });

        // Verify email configuration
        await transporter.verify();

        // Prepare attachments if any
        const attachments = req.files.attachments?.map(file => ({
            filename: file.originalname,
            content: file.buffer
        })) || [];

        const results = [];
        let successCount = 0;
        let failureCount = 0;

        // Send emails
        for (const recipient of recipients) {
            try {
                const email = recipient.Email || recipient.email;
                if (!email) {
                    results.push({
                        email: 'N/A',
                        status: 'skipped',
                        message: 'No email address found'
                    });
                    continue;
                }

                const name = recipient.Name || recipient.name || 'Sir/Madam';
                const company = recipient.Company || recipient.company || 'your organization';

                const personalizedMessage = messageTemplate
                    .replace(/{name}/g, name)
                    .replace(/{company}/g, company);

                await transporter.sendMail({
                    from: senderEmail,
                    to: email,
                    subject: subject,
                    text: personalizedMessage,
                    attachments: attachments
                });

                results.push({
                    email,
                    status: 'success'
                });
                successCount++;

                // Add delay between emails
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                results.push({
                    email: recipient.Email || recipient.email || 'N/A',
                    status: 'failed',
                    message: error.message
                });
                failureCount++;
            }
        }

        // Close the transporter
        transporter.close();

        // Send response
        res.json({
            success: true,
            results,
            summary: {
                total: recipients.length,
                success: successCount,
                failed: failureCount,
                skipped: recipients.length - (successCount + failureCount)
            }
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 


//! IMplementing Gemini?
