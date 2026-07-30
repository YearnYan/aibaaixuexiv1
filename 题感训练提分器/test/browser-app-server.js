process.env.QUESTION_SOURCE_URL = 'http://127.0.0.1:56271/questions';

const { app } = require('../server');

app.listen(56272, '127.0.0.1');
