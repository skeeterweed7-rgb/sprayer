import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, Auth } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, serverTimestamp, query, orderBy, getDocs, deleteDoc, Firestore } from 'firebase/firestore';
import { Truck, Droplet, PlusCircle, RotateCcw, Cloud, Wind, Download, Printer, Trash2, AlertTriangle, Search } from 'lucide-react';
import { ALL_ROADS, ALL_CHEMICALS, WIND_DIRECTIONS, firebaseConfig, appId, initialAuthToken } from './constants';
import { Chemical, LogEntry, WeatherConditions } from './types';

// Helper for collection path
const getCollectionPath = (uid: string) => `artifacts/${appId}/users/${uid}/gallon_logs`;

// Helper to format weather for display
const formatWeatherSummary = (conditions: WeatherConditions | null) => {
    if (!conditions || !conditions.weather) return 'N/A';
    const { weather, temperature, windDirection, windSpeed } = conditions;
    const temp = typeof temperature === 'number' ? `${temperature}°F` : '';
    const wind = typeof windSpeed === 'number' && windSpeed > 0 ? `${windSpeed} MPH (${windDirection})` : '';
    return `${weather} | ${temp} | Wind: ${wind}`;
};

const App: React.FC = () => {
    // --- FIREBASE STATE ---
    const [db, setDb] = useState<Firestore | null>(null);
    const [auth, setAuth] = useState<Auth | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    
    // --- INVENTORY STATE ---
    const [startingGallons, setStartingGallons] = useState(600);
    const [gallonsUsedOnRoad, setGallonsUsedOnRoad] = useState(0);
    const [gallonsLeft, setGallonsLeft] = useState(600); 
    const [gallonsToRefill, setGallonsToRefill] = useState(0); 
    
    // --- CHEMICAL MIX STATE ---
    const [chemicalMix, setChemicalMix] = useState<Chemical[]>([]);
    const [currentChemical, setCurrentChemical] = useState<{ name: string; totalOz: number }>({ name: '', totalOz: 0 });
    const [chemicalSearch, setChemicalSearch] = useState('');
    const [isChemicalDropdownVisible, setIsChemicalDropdownVisible] = useState(false);

    // --- ROAD SELECTION STATE ---
    const [roadSearch, setRoadSearch] = useState('');
    const [selectedRoad, setSelectedRoad] = useState('');
    const [isDropdownVisible, setIsDropdownVisible] = useState(false);

    // --- ENVIRONMENTAL CONDITIONS STATE ---
    const [weather, setWeather] = useState('');
    const [temperature, setTemperature] = useState(70);
    const [windDirection, setWindDirection] = useState('South West');
    const [windSpeed, setWindSpeed] = useState(5);

    // --- UI/STATUS STATE ---
    const [status, setStatus] = useState('Initializing...');
    const [showConfirmModal, setShowConfirmModal] = useState(false); 

    const updateStatus = useCallback((message: string, color: string = 'text-gray-600') => {
        setStatus(message);
        // We append the color info to the status string or handle it in rendering. 
        // For simplicity, we just update the text here, but the color logic is in `getStatusClasses`.
        // We can store status as an object { msg: string, type: string } but sticking to the provided logic structure:
        console.log(`Status: ${message} (${color})`);
    }, []);

    // --- FIREBASE INITIALIZATION ---
    useEffect(() => {
        if (!firebaseConfig || !firebaseConfig.projectId || firebaseConfig.projectId === 'YOUR_PROJECT_ID') {
            updateStatus('Warning: Using placeholder Firebase config. Firestore persistence may fail.', 'text-orange-500');
        }

        try {
            const app = initializeApp(firebaseConfig);
            const dbInstance = getFirestore(app);
            const authInstance = getAuth(app);
            setDb(dbInstance);
            setAuth(authInstance);

            const unsubscribeAuth = onAuthStateChanged(authInstance, async (user) => {
                let currentUserId = user ? user.uid : null;
                if (!currentUserId) {
                    if (initialAuthToken) { 
                        await signInWithCustomToken(authInstance, initialAuthToken);
                        if (authInstance.currentUser) {
                           currentUserId = authInstance.currentUser.uid;
                        }
                    } else {
                        await signInAnonymously(authInstance);
                        if (authInstance.currentUser) {
                            currentUserId = authInstance.currentUser.uid;
                        }
                    }
                }
                setUserId(currentUserId);
                setIsAuthReady(true);
                updateStatus('System Ready. Load current inventory.', 'text-green-600');
            });
            return () => unsubscribeAuth();
        } catch (error) {
            console.error("Firebase setup error:", error);
            updateStatus('Initialization Failed.', 'text-red-500');
        }
    }, [updateStatus]);

    // --- REAL-TIME HISTORY LISTENER ---
    useEffect(() => {
        if (!db || !userId) return;

        const logsQuery = query(collection(db, getCollectionPath(userId)), orderBy("timestamp", "asc"));

        const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
            const fetchedLogs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as LogEntry[];
            
            // Newest first
            setLogs(fetchedLogs.slice().reverse()); 
            
            const lastLog = fetchedLogs[fetchedLogs.length - 1];
            if (lastLog && typeof lastLog.gallonsLeft === 'number') {
                setGallonsLeft(lastLog.gallonsLeft);
            } else {
                setGallonsLeft(startingGallons); 
            }
            
            if (lastLog && typeof lastLog.initialTankVolume === 'number') {
                setStartingGallons(lastLog.initialTankVolume);
            }

        }, (error) => {
            console.error("Snapshot error:", error);
            updateStatus('Error loading logs.', 'text-red-500');
        });

        return () => unsubscribe();
    }, [db, userId, startingGallons, updateStatus]);

    // --- DERIVED STATE: Last Environmental Conditions ---
    const lastAppliedConditions = useMemo(() => {
        const lastAppLog = logs.find(log => log.roadName !== "TANK REFILL" && log.weatherConditions && log.weatherConditions.weather);
        
        if (lastAppLog && lastAppLog.weatherConditions) {
            setWeather(lastAppLog.weatherConditions.weather || '');
            setTemperature(lastAppLog.weatherConditions.temperature || 70);
            setWindDirection(lastAppLog.weatherConditions.windDirection || 'South West');
            setWindSpeed(lastAppLog.weatherConditions.windSpeed || 5);
            return lastAppLog.weatherConditions; 
        }
        return null;
    }, [logs]); 
    
    const formattedConditions = useMemo(() => formatWeatherSummary(lastAppliedConditions), [lastAppliedConditions]);

    // --- ROAD FILTERING ---
    const filteredRoads = useMemo(() => {
        if (!roadSearch) return ALL_ROADS;
        const lowerCaseSearch = roadSearch.toLowerCase();
        return ALL_ROADS.filter(road => road.toLowerCase().startsWith(lowerCaseSearch));
    }, [roadSearch]);

    const handleRoadSelect = (road: string) => {
        setRoadSearch(road);
        setSelectedRoad(road);
        setIsDropdownVisible(false);
    };

    // --- CHEMICAL FILTERING ---
    const filteredChemicals = useMemo(() => {
        if (!chemicalSearch) return ALL_CHEMICALS;
        const lowerCaseSearch = chemicalSearch.toLowerCase();
        return ALL_CHEMICALS.filter(chemical => chemical.toLowerCase().startsWith(lowerCaseSearch));
    }, [chemicalSearch]);

    const handleChemicalSelect = (chemical: string) => {
        setChemicalSearch(chemical);
        setCurrentChemical(prev => ({...prev, name: chemical}));
        setIsChemicalDropdownVisible(false);
    };

    // --- CHEMICAL MIX LOGIC ---
    const calculateOzPerGal = (totalOz: number, tankVolume: number) => {
        return tankVolume > 0 ? (totalOz / tankVolume).toFixed(4) : 0;
    };

    const handleChemicalAdd = () => {
        const totalOzValue = parseFloat(currentChemical.totalOz.toString());

        if (!currentChemical.name || isNaN(totalOzValue) || totalOzValue <= 0) {
            updateStatus('Please enter a valid chemical name and positive total ounces.', 'text-red-500');
            return;
        }
        
        const newChemical: Chemical = {
            ...currentChemical,
            totalOz: totalOzValue, 
            ozPerGal: calculateOzPerGal(totalOzValue, startingGallons)
        };

        setChemicalMix(prev => [...prev, newChemical]);
        setCurrentChemical({ name: '', totalOz: 0 });
        setChemicalSearch('');
    };

    const handleChemicalRemove = (index: number) => {
        setChemicalMix(prev => prev.filter((_, i) => i !== index));
    };

    useEffect(() => {
        setChemicalMix(prevMix =>
            prevMix.map(chem => ({
                ...chem,
                ozPerGal: calculateOzPerGal(chem.totalOz, startingGallons)
            }))
        );
    }, [startingGallons]);

    // --- REFILL LOGIC ---
    const performRefill = async (gallonsAdded: number) => {
        if (!isAuthReady || !db || !userId) {
            updateStatus('System is still initializing. Please wait.', 'text-yellow-500');
            return;
        }

        const currentTotal = gallonsLeft + gallonsAdded;
        const newGallonsLeft = Math.min(startingGallons, currentTotal);
        const actualAdded = newGallonsLeft - gallonsLeft;
        
        if (actualAdded <= 0.01) {
             updateStatus(`Could not refill: Tank is already full or amount added is too small.`, 'text-yellow-500');
            return;
        }

        try {
            const logsCollection = collection(db, getCollectionPath(userId));
            await addDoc(logsCollection, {
                roadName: "TANK REFILL",
                gallonsUsed: -actualAdded,
                gallonsLeft: parseFloat(newGallonsLeft.toFixed(2)),
                initialTankVolume: startingGallons,
                chemicalMix: [],
                weatherConditions: {},
                timestamp: serverTimestamp()
            });

            if (newGallonsLeft < currentTotal) {
                updateStatus(`Refilled tank by ${actualAdded.toFixed(2)} gallons (capped from ${gallonsAdded.toFixed(2)}).`, 'text-indigo-600');
            } else {
                updateStatus(`Refilled tank by ${actualAdded.toFixed(2)} gallons.`, 'text-indigo-600');
            }
            setGallonsToRefill(0);

        } catch (e) {
            console.error("Firestore Refill Error:", e);
            updateStatus('ERROR: Could not save refill log to database.', 'text-red-500');
        }
    };

    const handleRefill = () => {
        const gallons = parseFloat(gallonsToRefill.toString());
        if (isNaN(gallons) || gallons <= 0) {
            updateStatus('Please enter a positive amount of gallons to add.', 'text-red-500');
            return;
        }
        performRefill(gallons);
    };

    // --- LOGGING LOGIC ---
    const logApplication = async () => {
        const gallonsUsed = parseFloat(gallonsUsedOnRoad.toString());
        
        if (!selectedRoad || !selectedRoad.trim()) {
            updateStatus('Please select a Road Name.', 'text-red-500');
            return;
        }
        if (isNaN(gallonsUsed) || gallonsUsed <= 0) {
            updateStatus('Please enter a valid amount of Gallons Used.', 'text-red-500');
            return;
        }
        if (gallonsUsed > gallonsLeft) {
             updateStatus(`Gallons Used (${gallonsUsed}) exceeds Gallons Left (${gallonsLeft}). Please refill.`, 'text-red-500');
            return;
        }
        if (chemicalMix.length === 0) {
            updateStatus('Please add at least one chemical to the mix before logging.', 'text-red-500');
            return;
        }
        if (!weather.trim() || !temperature || !windDirection || !windSpeed) {
            updateStatus('Please complete all Environmental Conditions fields.', 'text-red-500');
            return;
        }

        if (!isAuthReady || !db || !userId) {
            updateStatus('System is still initializing. Please wait.', 'text-yellow-500');
            return;
        }

        const newGallonsLeft = gallonsLeft - gallonsUsed;
        
        try {
            const logsCollection = collection(db, getCollectionPath(userId));
            await addDoc(logsCollection, {
                roadName: selectedRoad,
                gallonsUsed: parseFloat(gallonsUsed.toFixed(2)),
                gallonsLeft: parseFloat(newGallonsLeft.toFixed(2)),
                initialTankVolume: startingGallons,
                chemicalMix: chemicalMix,
                weatherConditions: {
                    weather: weather.trim(),
                    temperature: parseFloat(temperature.toString()),
                    windDirection: windDirection,
                    windSpeed: parseFloat(windSpeed.toString()),
                },
                timestamp: serverTimestamp()
            });

            setGallonsUsedOnRoad(0);
            setSelectedRoad('');
            setRoadSearch('');
            updateStatus(`Logged ${gallonsUsed.toFixed(2)} gallons for ${selectedRoad}.`, 'text-blue-600');

        } catch (e) {
            console.error("Firestore Error:", e);
            updateStatus('ERROR: Could not save log to database.', 'text-red-500');
        }
    };
    
    // --- REPORT GENERATION ---
    const generateReportContent = useCallback(() => {
        const applicationLogs = logs.filter(log => log.roadName !== "TANK REFILL");
        const refillLogs = logs.filter(log => log.roadName === "TANK REFILL");
        
        let txtContent = '============================================\n';
        txtContent += `APPLICATION HISTORY REPORT\n`;
        txtContent += '============================================\n';
        txtContent += `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
        txtContent += `User ID: ${userId}\n`;
        txtContent += `Total Tank Capacity: ${startingGallons} gallons\n`;
        txtContent += `Total Road Applications: ${applicationLogs.length}\n`;
        txtContent += `Total Refills: ${refillLogs.length}\n`;
        txtContent += '============================================\n\n';

        if (lastAppliedConditions) {
            const { weather, temperature, windDirection, windSpeed } = lastAppliedConditions;
            txtContent += '>>> ENVIRONMENTAL CONDITIONS (Last Logged) <<<\n';
            txtContent += `Weather: ${weather}\n`;
            txtContent += `Temperature: ${temperature}°F\n`;
            txtContent += `Wind: ${windSpeed} MPH from the ${windDirection}\n`;
            txtContent += '--------------------------------------------\n\n';
        } else {
            txtContent += '>>> ENVIRONMENTAL CONDITIONS: N/A\n';
            txtContent += '--------------------------------------------\n\n';
        }

        txtContent += '>>> ROAD APPLICATION LOGS <<<\n';
        txtContent += '--------------------------------------------\n';
        
        if (applicationLogs.length === 0) {
            txtContent += 'No road application data to report.\n\n';
        } else {
            applicationLogs.forEach((log, index) => {
                const timestamp = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : 'N/A';
                
                txtContent += `ENTRY #${applicationLogs.length - index} (Logged: ${timestamp})\n`;
                txtContent += `Road Name: ${log.roadName}\n`;
                txtContent += `Gallons Used: ${log.gallonsUsed.toFixed(2)} gal\n`;
                txtContent += `Gallons Left: ${log.gallonsLeft.toFixed(2)} gal\n`;
                txtContent += `  Chemical Mix:\n`;
                log.chemicalMix.forEach(chem => {
                    const ozPerGal = parseFloat(chem.ozPerGal as string) || 0;
                    const gallonsUsed = parseFloat(log.gallonsUsed.toString()) || 0;
                    const ozCalculated = gallonsUsed * ozPerGal;
                    txtContent += `    - ${chem.name}: ${ozCalculated.toFixed(2)} oz applied\n`;
                });
                txtContent += '--------------------------------------------\n';
            });
        }
        
        txtContent += '\n>>> TANK REFILL LOGS <<<\n';
        txtContent += '--------------------------------------------\n';

        if (refillLogs.length === 0) {
            txtContent += 'No tank refill data to report.\n\n';
        } else {
             refillLogs.forEach((log, index) => {
                const timestamp = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : 'N/A';
                txtContent += `REFILL #${refillLogs.length - index} (Logged: ${timestamp})\n`;
                txtContent += `Gallons ADDED: ${Math.abs(log.gallonsUsed).toFixed(2)} gal\n`;
                txtContent += `Gallons Left: ${log.gallonsLeft.toFixed(2)} gal\n`;
                txtContent += '--------------------------------------------\n';
            });
        }
        return txtContent;
    }, [logs, userId, startingGallons, lastAppliedConditions]);


    // --- EXPORT ACTIONS ---
    const downloadHistoryAsTxt = useCallback(() => {
        if (logs.length === 0) {
            updateStatus('No history logs to export.', 'text-yellow-500');
            return;
        }
        const txtContent = generateReportContent();
        const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Gallon_Log_Report_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateStatus('History downloaded as TXT file.', 'text-blue-600');
    }, [logs, generateReportContent, updateStatus]);
    
    const handlePrintReport = useCallback(() => {
        if (logs.length === 0) {
            updateStatus('No history logs to print.', 'text-yellow-500');
            return;
        }
        const txtContent = generateReportContent();
        const printWindow = window.open('', '', 'height=600,width=800');
        if (!printWindow) {
            updateStatus('Print blocked by pop-up blocker.', 'text-red-500');
            return;
        }
        const reportTitle = "Gallon Logger History Report";
        const printHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>${reportTitle}</title>
                <style>
                    body { font-family: monospace; white-space: pre-wrap; margin: 20px; font-size: 12px; }
                </style>
            </head>
            <body><pre>${txtContent}</pre></body>
            </html>
        `;
        printWindow.document.write(printHtml);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        updateStatus('Print window opened.', 'text-blue-600');
    }, [logs, generateReportContent, updateStatus]);

    const getStatusClasses = (statusMsg: string) => {
        let color = 'text-gray-600';
        if (statusMsg.includes('Error') || statusMsg.includes('exceeds') || statusMsg.includes('Failed')) {
            color = 'text-red-500';
        } else if (statusMsg.includes('Ready') || statusMsg.includes('cleared')) {
            color = 'text-green-600';
        } else if (statusMsg.includes('Logged') || statusMsg.includes('downloaded')) {
             color = 'text-blue-600';
        } else if (statusMsg.includes('Refilled')) {
            color = 'text-indigo-600';
        } else if (statusMsg.includes('initializing') || statusMsg.includes('Warning')) {
            color = 'text-yellow-500';
        }
        return `text-sm font-semibold mt-4 text-center ${color}`;
    };

    const confirmResetHistory = async () => {
        setShowConfirmModal(false); 
        if(!db || !userId) return;
        updateStatus('Clearing history...', 'text-yellow-600');
        
        try {
            const logsCollectionRef = collection(db, getCollectionPath(userId));
            const snapshot = await getDocs(logsCollectionRef);
            const deletionPromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
            await Promise.all(deletionPromises);
            
            setStartingGallons(600);
            setGallonsLeft(600); 
            setGallonsUsedOnRoad(0);
            setChemicalMix([]);
            setCurrentChemical({ name: '', totalOz: 0 });
            setChemicalSearch('');
            setRoadSearch('');
            setSelectedRoad('');
            setGallonsToRefill(0); 
            setWeather('');
            setTemperature(70);
            setWindDirection('South West');
            setWindSpeed(5);

            updateStatus('History cleared. Ready for new job!', 'text-blue-600');
        } catch (e) {
            console.error("Firestore Reset Error:", e);
            updateStatus('ERROR: Could not clear history.', 'text-red-500');
        }
    };
    
    const handleRestartJob = () => {
        if (!isAuthReady || !db || !userId) {
            updateStatus('System initializing...', 'text-yellow-500');
            return;
        }
        setShowConfirmModal(true); 
    };

    // --- RENDER ---
    return (
        <div className="bg-slate-50 min-h-screen p-4 md:p-8 font-sans">
            
            {/* MODAL */}
            {showConfirmModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 border border-red-100">
                        <div className="flex items-center text-red-600">
                            <AlertTriangle className="w-6 h-6 mr-2" />
                            <h3 className="text-xl font-bold">Reset Application?</h3>
                        </div>
                        <p className="text-slate-600 text-sm">
                            This will <strong>permanently delete all history logs</strong> for this job. This action cannot be undone.
                        </p>
                        <div className="flex justify-end space-x-3 pt-2">
                            <button 
                                onClick={() => setShowConfirmModal(false)}
                                className="px-4 py-2 text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition font-medium"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmResetHistory}
                                className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition shadow-sm"
                            >
                                Yes, Delete All
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
                {/* HEADER */}
                <div className="bg-indigo-900 text-white p-6 print-hide">
                    <div className="flex items-center justify-center space-x-3 mb-2">
                        <Truck className="w-8 h-8 text-indigo-300" />
                        <h1 className="text-3xl font-extrabold tracking-tight">Gallon Logger</h1>
                    </div>
                    <p className="text-center text-indigo-200 text-sm">Professional Tank Inventory & Application Tracking</p>
                </div>

                <div className="p-6 md:p-10 space-y-8">
                    
                    {/* DASHBOARD (Print Hide) */}
                    <div className="print-hide grid grid-cols-1 lg:grid-cols-3 gap-8">
                        
                        {/* COL 1: Inventory */}
                        <div className="lg:col-span-1 space-y-6">
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-center relative overflow-hidden group">
                                <div className={`absolute top-0 left-0 w-full h-1 ${gallonsLeft > startingGallons * 0.2 ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Current Inventory</h2>
                                <div className="flex items-baseline justify-center">
                                    <span className={`text-5xl font-black ${gallonsLeft > startingGallons * 0.2 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {Math.max(0, gallonsLeft).toFixed(0)}
                                    </span>
                                    <span className="text-slate-400 ml-1 font-medium">gal</span>
                                </div>
                                <p className="text-xs text-slate-400 mt-2">Capacity: {startingGallons} gal</p>
                            </div>

                            <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                                <div className="flex items-center text-indigo-900 font-bold mb-4">
                                    <RotateCcw className="w-4 h-4 mr-2" />
                                    <h3>Tank Operations</h3>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">Total Capacity</label>
                                        <input 
                                            type="number" 
                                            value={startingGallons || ''}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value) || 1;
                                                setStartingGallons(val);
                                                setGallonsLeft(prev => Math.min(val, prev));
                                            }}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">Refill Amount</label>
                                        <div className="flex space-x-2">
                                            <input 
                                                type="number" 
                                                value={gallonsToRefill || ''}
                                                onChange={(e) => setGallonsToRefill(parseFloat(e.target.value) || 0)}
                                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                                placeholder="0"
                                            />
                                            <button 
                                                onClick={handleRefill}
                                                disabled={gallonsToRefill <= 0}
                                                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-4 rounded-lg transition-colors flex items-center justify-center"
                                            >
                                                <PlusCircle className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* COL 2 & 3: Mix & Environment */}
                        <div className="lg:col-span-2 space-y-6">
                            
                            {/* Chemical Mix */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                                <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
                                    <Droplet className="w-5 h-5 mr-2 text-purple-500" />
                                    Chemical Mix
                                </h2>
                                <div className="flex flex-col md:flex-row gap-3 mb-4">
                                    <div className="relative flex-grow">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <Search className="h-4 w-4 text-slate-400" />
                                        </div>
                                        <input 
                                            type="text" 
                                            placeholder="Search chemical..."
                                            value={chemicalSearch}
                                            onChange={(e) => {
                                                setChemicalSearch(e.target.value);
                                                setCurrentChemical(prev => ({...prev, name: e.target.value}));
                                                setIsChemicalDropdownVisible(true);
                                            }}
                                            onFocus={() => setIsChemicalDropdownVisible(true)}
                                            onBlur={() => setTimeout(() => setIsChemicalDropdownVisible(false), 200)}
                                            className="pl-9 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        />
                                        {isChemicalDropdownVisible && filteredChemicals.length > 0 && (
                                            <div className="absolute w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                                                {filteredChemicals.map(c => (
                                                    <div 
                                                        key={c} 
                                                        onClick={() => handleChemicalSelect(c)}
                                                        className="px-4 py-2 hover:bg-purple-50 cursor-pointer text-sm text-slate-700"
                                                    >
                                                        {c}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <input 
                                        type="number" 
                                        placeholder="Oz"
                                        value={currentChemical.totalOz || ''}
                                        onChange={(e) => setCurrentChemical(prev => ({...prev, totalOz: parseFloat(e.target.value)}))}
                                        className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-purple-500"
                                    />
                                    <button 
                                        onClick={handleChemicalAdd}
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        Add
                                    </button>
                                </div>
                                
                                <div className="space-y-2">
                                    {chemicalMix.length === 0 ? (
                                        <div className="text-center py-4 text-slate-400 text-sm bg-slate-50 rounded-lg border border-dashed border-slate-200">
                                            No chemicals added to mix
                                        </div>
                                    ) : (
                                        chemicalMix.map((c, i) => (
                                            <div key={i} className="flex justify-between items-center bg-purple-50 px-3 py-2 rounded-lg border border-purple-100">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-purple-900">{c.name}</span>
                                                    <span className="text-xs text-purple-600">{c.totalOz} oz ({c.ozPerGal} oz/gal)</span>
                                                </div>
                                                <button onClick={() => handleChemicalRemove(i)} className="text-purple-400 hover:text-red-500 transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Environment & Action */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Environment */}
                                <div className="bg-amber-50 rounded-xl border border-amber-100 p-5">
                                    <h3 className="text-amber-800 font-bold text-sm mb-3 flex items-center">
                                        <Cloud className="w-4 h-4 mr-2" />
                                        Conditions
                                    </h3>
                                    <div className="space-y-3">
                                        <input 
                                            type="text" 
                                            placeholder="Weather (e.g. Clear)" 
                                            value={weather}
                                            onChange={e => setWeather(e.target.value)}
                                            className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm focus:ring-1 focus:ring-amber-400 outline-none"
                                        />
                                        <div className="flex space-x-2">
                                            <div className="relative flex-1">
                                                <input 
                                                    type="number" 
                                                    value={temperature || ''}
                                                    onChange={e => setTemperature(parseFloat(e.target.value))}
                                                    className="w-full pl-3 pr-8 py-2 bg-white border border-amber-200 rounded-lg text-sm outline-none"
                                                />
                                                <span className="absolute right-3 top-2 text-xs text-amber-400">°F</span>
                                            </div>
                                            <div className="relative flex-1">
                                                <input 
                                                    type="number" 
                                                    value={windSpeed || ''}
                                                    onChange={e => setWindSpeed(parseFloat(e.target.value))}
                                                    className="w-full pl-3 pr-10 py-2 bg-white border border-amber-200 rounded-lg text-sm outline-none"
                                                />
                                                <span className="absolute right-3 top-2 text-xs text-amber-400">mph</span>
                                            </div>
                                        </div>
                                        <select 
                                            value={windDirection}
                                            onChange={e => setWindDirection(e.target.value)}
                                            className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm outline-none text-slate-600"
                                        >
                                            {WIND_DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* Action Card */}
                                <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-5 flex flex-col">
                                    <h3 className="text-emerald-800 font-bold text-sm mb-3 flex items-center">
                                        <Truck className="w-4 h-4 mr-2" />
                                        Log Job
                                    </h3>
                                    <div className="relative flex-grow mb-3">
                                        <input 
                                            type="text" 
                                            placeholder="Road Name..." 
                                            value={roadSearch}
                                            onChange={(e) => {
                                                setRoadSearch(e.target.value);
                                                setSelectedRoad(e.target.value);
                                                setIsDropdownVisible(true);
                                            }}
                                            onFocus={() => setIsDropdownVisible(true)}
                                            className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none"
                                        />
                                        {isDropdownVisible && roadSearch.length > 0 && filteredRoads.length > 0 && (
                                            <div className="absolute w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-40 overflow-y-auto">
                                                {filteredRoads.map(r => (
                                                    <div 
                                                        key={r} 
                                                        onMouseDown={() => handleRoadSelect(r)}
                                                        className="px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm text-slate-700"
                                                    >
                                                        {r}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center space-x-2 mb-4">
                                        <input 
                                            type="number" 
                                            placeholder="Gal Used" 
                                            value={gallonsUsedOnRoad || ''}
                                            onChange={e => setGallonsUsedOnRoad(parseFloat(e.target.value) || 0)}
                                            className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-lg font-bold text-emerald-800 focus:ring-2 focus:ring-emerald-400 outline-none"
                                        />
                                    </div>
                                    <button 
                                        onClick={logApplication}
                                        className="w-full mt-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg shadow-md hover:shadow-lg transition-all"
                                    >
                                        LOG ENTRY
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className={getStatusClasses(status)}>
                        {status}
                    </div>

                    {/* HISTORY TABLE */}
                    <div className="pt-8 border-t border-slate-200">
                        <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center mb-6 gap-4 print-hide">
                            <h2 className="text-2xl font-bold text-slate-800">History Log</h2>
                            <div className="flex gap-2">
                                <button 
                                    onClick={handlePrintReport}
                                    className="flex items-center px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm font-medium shadow-sm"
                                >
                                    <Printer className="w-4 h-4 mr-2" />
                                    Print
                                </button>
                                <button 
                                    onClick={downloadHistoryAsTxt}
                                    className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium shadow-md"
                                >
                                    <Download className="w-4 h-4 mr-2" />
                                    Export .txt
                                </button>
                            </div>
                        </div>

                        {/* Print Only Summary */}
                        <div className="hidden print-block mb-6 p-4 border border-slate-300 rounded">
                            <h3 className="font-bold text-lg mb-2">Job Summary</h3>
                            <p>Total Logs: {logs.filter(l => l.roadName !== "TANK REFILL").length}</p>
                            <p>Conditions: {formattedConditions}</p>
                        </div>

                        <div className="overflow-x-auto bg-white rounded-xl border border-slate-200 shadow-sm">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Road / Event</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Gallons</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Chemical Breakdown</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-200">
                                    {logs.filter(l => l.roadName !== "TANK REFILL").length === 0 ? (
                                        <tr>
                                            <td colSpan={3} className="px-6 py-8 text-center text-slate-400 text-sm italic">
                                                No road applications logged yet.
                                            </td>
                                        </tr>
                                    ) : (
                                        logs.filter(l => l.roadName !== "TANK REFILL").map((log) => (
                                            <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-800">
                                                    {log.roadName}
                                                    <div className="text-xs text-slate-400 font-normal mt-1">
                                                        {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 font-medium">
                                                    {log.gallonsUsed.toFixed(1)}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-slate-600">
                                                    {log.chemicalMix.length > 0 ? (
                                                        <ul className="space-y-1">
                                                            {log.chemicalMix.map((c, i) => (
                                                                <li key={i} className="flex justify-between max-w-xs">
                                                                    <span>{c.name}:</span>
                                                                    <span className="font-bold text-slate-800 ml-2">
                                                                        {(log.gallonsUsed * (typeof c.ozPerGal === 'number' ? c.ozPerGal : parseFloat(c.ozPerGal))).toFixed(2)} oz
                                                                    </span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : <span className="text-slate-400">-</span>}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        
                        <div className="print-hide mt-8 flex justify-center">
                            <button 
                                onClick={handleRestartJob}
                                className="text-red-500 text-sm hover:text-red-700 underline decoration-dotted underline-offset-4 transition-colors"
                            >
                                Reset Job & Clear History
                            </button>
                        </div>

                        <div className="print-hide mt-4 text-center text-xs text-slate-300">
                            ID: {userId || '...'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;