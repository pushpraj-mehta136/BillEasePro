const bcrypt = require('bcrypt');
bcrypt.hash('pushpraj', 10).then(hash => console.log(hash));
