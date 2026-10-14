import fs from 'fs';
const lines = fs.readFileSync('src/App.tsx', 'utf8').split('\n');
fs.writeFileSync('src/App.tsx', lines.slice(0, 2571).join('\n') + '\nimport { DashboardTab } from \'./pages/DashboardTab\';\n');
console.log('done!');
