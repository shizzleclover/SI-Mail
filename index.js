const express = require('express');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const app = express();

// Basic middleware
app.use(express.json());
app.use(express.static('public'));

// Gemini API configuration
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent`;

// Store chat history
let chatHistory = [];

// Configure multer for memory storage
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

// Gemini chat function
async function generateBotResponse(userMessage, fileData = null) {
    try {
        const messageParts = [{ text: userMessage }];
        if (fileData) {
            messageParts.push({ inline_data: fileData });
        }

        chatHistory.push({
            role: "user",
            parts: messageParts
        });

        const response = await fetch(API_URL, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                contents: chatHistory
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error.message);
        }

        const data = await response.json();
        const botResponse = data.candidates[0].content.parts[0].text.trim();

        chatHistory.push({
            role: "model",
            parts: [{ text: botResponse }]
        });

        return botResponse;

    } catch (error) {
        console.error('Gemini API Error:', error);
        throw error;
    }
}

// Chat endpoint
app.post('/chat', async (req, res) => {
    try {
        const { message, fileData } = req.body;
        
        if (!message) {
            throw new Error('Message is required');
        }

        const botResponse = await generateBotResponse(message, fileData);
        
        res.json({
            success: true,
            response: botResponse
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// Clear chat history endpoint
app.post('/clear-chat', (req, res) => {
    chatHistory = [];
    res.json({
        success: true,
        message: 'Chat history cleared'
    });
});

// Email sending endpoint
app.post('/send-emails', async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            upload(req, res, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        if (!req.files?.excelFile?.[0]?.buffer) {
            throw new Error('No Excel file uploaded');
        }

        const { subject, messageTemplate, senderEmail, senderPassword } = req.body;

        if (!subject || !messageTemplate || !senderEmail || !senderPassword) {
            throw new Error('Missing required fields');
        }

        const recipients = await readExcelBuffer(req.files.excelFile[0].buffer);
        
        if (!recipients || recipients.length === 0) {
            throw new Error('No recipients found in Excel file');
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: senderEmail,
                pass: senderPassword
            }
        });

        await transporter.verify();

        const attachments = req.files.attachments?.map(file => ({
            filename: file.originalname,
            content: file.buffer
        })) || [];

        const results = [];
        let successCount = 0;
        let failureCount = 0;

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

        transporter.close();

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
    console.log(`Server running on port $http://localhost:3000`);
});