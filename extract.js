const fs = require('fs');
const html = fs.readFileSync('vivareal_sample.html', 'utf8');
const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
if (match) {
  fs.writeFileSync('next_data.json', match[1]);
  console.log('JSON extracted.');
} else {
  console.log('__NEXT_DATA__ not found.');
}
