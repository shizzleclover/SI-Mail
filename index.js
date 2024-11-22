const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const express = require('express');
const path = require('path');
require('dotenv').config();
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024 // 25MB limit
    }
}).fields([
    { name: 'excelFile', maxCount: 1 },
    { name: 'attachments', maxCount: 10 }
]);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Function to read Excel file
async function readExcelFile(filePath) {
    try {
        console.log('Reading Excel file from:', filePath);
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        console.log('Excel data read successfully:', data.length, 'rows');
        return data;
    } catch (error) {
        console.error('Excel reading error:', error);
        throw new Error('Error reading Excel file: ' + error.message);
    }
}

// Add these helper functions at the top
function validateExcelStructure(data) {
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Excel file is empty or invalid');
    }

    const firstRow = data[0];
    const hasEmailColumn = 'email' in firstRow || 'Email' in firstRow;
    
    if (!hasEmailColumn) {
        throw new Error('Excel file must contain an "Email" column');
    }

    return true;
}

function sanitizeEmail(email) {
    return email.trim().toLowerCase();
}

app.post('/send-emails', async (req, res) => {
    const uploadedFiles = [];
    let transporter = null;

    try {
        // Handle upload
        await new Promise((resolve, reject) => {
            upload(req, res, (err) => {
                if (err) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        reject(new Error('File size too large. Maximum size is 25MB'));
                    } else {
                        reject(err);
                    }
                }
                resolve();
            });
        });

        // Validate request body
        const { subject, messageTemplate, senderEmail, senderPassword } = req.body;

        if (!subject?.trim()) throw new Error('Email subject is required');
        if (!messageTemplate?.trim()) throw new Error('Message template is required');
        if (!senderEmail?.trim()) throw new Error('Sender email is required');
        if (!senderPassword?.trim()) throw new Error('App password is required');

        // Validate Excel file
        if (!req.files?.excelFile?.[0]) {
            throw new Error('Excel file is required');
        }

        const excelFile = req.files.excelFile[0];
        uploadedFiles.push(excelFile.path);

        // Validate file type
        const allowedTypes = ['.xlsx', '.xls'];
        const fileExt = path.extname(excelFile.originalname).toLowerCase();
        if (!allowedTypes.includes(fileExt)) {
            throw new Error('Invalid file type. Only Excel files (.xlsx, .xls) are allowed');
        }

        // Create email transporter
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: sanitizeEmail(senderEmail),
                pass: senderPassword
            }
        });

        // Verify email configuration
        try {
            console.log('Verifying email credentials...');
            await transporter.verify();
            console.log('Email credentials verified successfully');
        } catch (error) {
            console.error('Email verification failed:', error);
            if (error.message.includes('Invalid login')) {
                res.status(401).json({
                    success: false,
                    error: 'Invalid email or app password. Please check your credentials.'
                });
                return;
            }
            throw new Error(`Email verification failed: ${error.message}`);
        }

        // Read and validate Excel data
        const recipients = await readExcelFile(excelFile.path);
        validateExcelStructure(recipients);

        // Process attachments
        const attachments = req.files.attachments?.map(file => {
            uploadedFiles.push(file.path);
            return {
                filename: file.originalname,
                path: file.path
            };
        }) || [];

        // Send emails
        const results = [];
        let successCount = 0;
        let failureCount = 0;

        for (const recipient of recipients) {
            try {
                const email = recipient.Email || recipient.email;
                if (!email || !isValidEmail(email)) {
                    results.push({
                        email: email || 'Invalid',
                        status: 'skipped',
                        message: 'Invalid email address'
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
                    to: sanitizeEmail(email),
                    subject: subject,
                    text: personalizedMessage,
                    attachments: attachments
                });

                results.push({
                    email,
                    status: 'success'
                });
                successCount++;

                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                results.push({
                    email: recipient.Email || recipient.email,
                    status: 'failed',
                    message: error.message
                });
                failureCount++;
            }
        }

        // Clean up files
        await Promise.all(uploadedFiles.map(file => 
            fs.promises.unlink(file).catch(err => 
                console.error(`Failed to delete file ${file}:`, err)
            )
        ));

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
        // Clean up files on error
        await Promise.all(uploadedFiles.map(file =>
            fs.promises.unlink(file).catch(console.error)
        ));

        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        if (transporter) {
            transporter.close();
        }
    }
});

// Helper function to validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(String(email).toLowerCase());
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir);
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Uploads directory: ${uploadsDir}`);
}); 
