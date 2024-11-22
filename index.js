const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Static files
app.use(express.static('public'));
app.use(express.json());

// Import and use auth routes
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// Middleware to check authentication
const checkAuth = (req, res, next) => {
    if (!req.session.tokens) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
};

// Your existing email sending route with OAuth
app.post('/send-emails', checkAuth, async (req, res) => {
    try {
        // Create transporter with OAuth2
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: req.session.email,
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                refreshToken: req.session.tokens.refresh_token,
                accessToken: req.session.tokens.access_token
            }
        });

        // Rest of your email sending logic...
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 
