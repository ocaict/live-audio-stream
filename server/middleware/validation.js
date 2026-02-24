const { body, param, validationResult } = require('express-validator');
const path = require('path');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

const loginValidation = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username is required')
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6, max: 100 })
    .withMessage('Password must be 6-100 characters'),
  
  validate
];

const recordingIdValidation = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Recording ID is required')
    .isUUID(4)
    .withMessage('Invalid recording ID format')
    .custom((value) => {
      if (value.includes('..') || value.includes('/') || value.includes('\\')) {
        throw new Error('Invalid characters in ID');
      }
      return true;
    }),
  
  validate
];

const recordingIdOptionalValidation = [
  param('id')
    .optional()
    .isUUID(4)
    .withMessage('Invalid recording ID format')
    .custom((value) => {
      if (value && (value.includes('..') || value.includes('/') || value.includes('\\'))) {
        throw new Error('Invalid characters in ID');
      }
      return true;
    }),
  
  validate
];

module.exports = {
  validate,
  loginValidation,
  recordingIdValidation,
  recordingIdOptionalValidation
};
