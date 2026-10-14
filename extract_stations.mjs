import fs from 'fs';

const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');

const startIndex = 403;
const endIndex = 1193;

const tabContent = lines.slice(startIndex, endIndex).join('\n');

const newFileContent = `import React, { useState } from 'react';
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../firebase';
import { Station, Report, ValidationWarning } from '../types';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { cn } from '../lib/utils';
import { MapPin, Search, Edit2, Trash2, Plus, Upload, X, Map, Activity, CheckCircle2, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { handleFirestoreError } from '../lib/firebase-utils';

export ` + tabContent.replace(/function StationsTab/, 'function StationsTab') + '\n';

fs.writeFileSync('src/pages/StationsTab.tsx', newFileContent);

lines.splice(startIndex, endIndex - startIndex, "import { StationsTab } from './pages/StationsTab';");
fs.writeFileSync('src/App.tsx', lines.join('\n'));

console.log('Done moving StationsTab!');
