import fs from 'fs';

const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');

const startIndex = 117;
const endIndex = 875;

const tabContent = lines.slice(startIndex, endIndex).join('\n');

const newFileContent = `import React, { useState, useMemo, useEffect } from 'react';
import { collection, addDoc, doc, updateDoc, query, getDocs } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../firebase';
import { Station, User, EquipmentDict, TaskGroup, TechItem, Report, ReportDetail } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { cn } from '../lib/utils';
import { FileText, Save, CheckCircle, Image as ImageIcon, MessageSquare, X, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { handleFirestoreError } from '../lib/firebase-utils';

export ` + tabContent.replace(/function ReportsTab/, 'function ReportsTab') + '\n';

fs.writeFileSync('src/pages/ReportsTab.tsx', newFileContent);

lines.splice(startIndex, endIndex - startIndex, "import { ReportsTab } from './pages/ReportsTab';");
fs.writeFileSync('src/App.tsx', lines.join('\n'));

console.log('Done moving ReportsTab!');
