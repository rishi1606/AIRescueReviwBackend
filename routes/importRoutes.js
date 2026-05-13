const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');
const auth = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

router.post('/upload', auth, upload.array('files', 10), importController.uploadCsv);
router.get('/history', auth, importController.getImportHistory);
router.delete('/clear', auth, importController.clearAllData);
router.post('/analyze-all', auth, importController.runFullAnalysis);
router.get('/template', importController.getTemplate);

module.exports = router;
