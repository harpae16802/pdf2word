require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const FormData = require('form-data');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());

app.post('/api/convert', upload.single('file'), async (req, res) => {
    const file = req.file;
    const format = req.body.format;

    if (!file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = path.join(__dirname, file.path);
    const originalFilename = file.originalname;
    const outputPath = path.join(__dirname, `uploads/${file.filename}.${format}`);

    if (format !== 'docx') {
        return res.status(400).send('Unsupported format.');
    }

    try {
        const createJobResponse = await axios.post('https://api.cloudconvert.com/v2/jobs', {
            tasks: {
                'import-my-file': {
                    operation: 'import/upload'
                },
                'convert-my-file': {
                    operation: 'convert',
                    input: 'import-my-file',
                    output_format: format,
                },
                'export-my-file': {
                    operation: 'export/url',
                    input: 'convert-my-file'
                }
            }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.CLOUDCONVERT_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const uploadTask = createJobResponse.data.data.tasks.find(task => task.name === 'import-my-file');
        console.log('Upload Task:', uploadTask);

        // 打印上传表单参数
        console.log('Upload Form Parameters:', uploadTask.result.form.parameters);

        const formData = new FormData();
        for (const [key, value] of Object.entries(uploadTask.result.form.parameters)) {
            formData.append(key, value);
        }
        formData.append('file', fs.createReadStream(filePath), originalFilename);

        const uploadResponse = await axios.post(uploadTask.result.form.url, formData, {
            headers: {
                ...formData.getHeaders()
            }
        });

        console.log('Upload Response:', uploadResponse.data);

        const jobId = createJobResponse.data.data.id;
        let jobResponse;
        while (true) {
            jobResponse = await axios.get(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.CLOUDCONVERT_API_KEY}`
                }
            });
            console.log('Job Status:', jobResponse.data.data.status);

            if (jobResponse.data.data.status === 'error') {
                console.error('Job Error:', jobResponse.data.data.tasks);
                break;
            }

            if (jobResponse.data.data.status === 'finished') break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (jobResponse.data.data.status === 'error') {
            res.status(500).send('Error converting file.');
            return;
        }

        const exportTask = jobResponse.data.data.tasks.find(task => task.name === 'export-my-file');
        const downloadUrl = exportTask.result.files[0].url;
        console.log('Download URL:', downloadUrl);

        res.json({ downloadUrl });
    } catch (error) {
        console.error('Error converting file:', error.response ? error.response.data : error.message);
        res.status(500).send('Error converting file.');
    } finally {
        fs.unlinkSync(filePath);
    }
});

app.listen(3001, () => {
    console.log('Server is running on port 3001');
});
