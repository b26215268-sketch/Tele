import fs from 'fs';

const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');

const startIndex = 1950;
const endIndex = 2568; 

const plannerTabContent = lines.slice(startIndex, endIndex).join('\n');

const newFileContent = `import React, { useState, useEffect, useMemo } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { Map as MapIcon, List, Calendar, MapPin, CheckCircle, CalendarClock, Loader2, X, Crosshair, ArrowRight, Trash2, Edit2 } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import { db } from '../firebase';
import { Station, DailyPlan, User, Report } from '../types';
import { Button } from '../components/ui/Button';
import { BRAND_COLORS, getStationIcon } from '../lib/constants';
import { cn } from '../lib/utils';
import { MapUpdater } from '../components/MapComponents';

` + plannerTabContent + '\n';

fs.writeFileSync('src/pages/PlannerTab.tsx', newFileContent);

lines.splice(startIndex, endIndex - startIndex, "import { PlannerTab } from './pages/PlannerTab';");
fs.writeFileSync('src/App.tsx', lines.join('\n'));

console.log('Done moving PlannerTab!');
