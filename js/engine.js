// js/engine.js
import { drawBestMoveArrow, clearArrow } from './board.js';
import { initChartUI, addChartPoint, closeChartUI } from './chart.js';
import { customTranslator, formatPvSequenceVietnamese, executeMove, instantJumpToNode, getMoveHistoryString } from './game.js'; 
import { showToast, showAILoading, hideAILoading } from './ui.js';
import { getStrictLegalMoves } from './rules.js';
import { state, storage } from './state.js'; 
import { queryLocalBookWorker } from './localbook.js';
import { normalizeScore, evaluateMoveScore, classifyMove, calculateWinRatePercentage } from './analyzer.js';

let chartCurrentNode = null;
let chartTimerId = null;
let chartLatestCP = null; 
let chartLatestMate = null; 
let chartNodeStartTime = 0;

let pendingAction = null; 
let stopTimeoutId = null; 
let isEngineSearching = false; 
let cloudBookTimeoutId = null; 
let lastUiUpdateTime = 0;

let currentEngineInstance = null; 
let currentWasmType = null;
let fallbackTriggered = false;

export let botProfiles = { 
    standard: [
        {id: 1, levelName: "Cấp 1", uciSkillLevel: 0, searchDepth: 4, maxMovetimeMs: 200},
        {id: 2, levelName: "Cấp 2", uciSkillLevel: 2, searchDepth: 6, maxMovetimeMs: 400},
        {id: 3, levelName: "Cấp 3", uciSkillLevel: 4, searchDepth: 8, maxMovetimeMs: 600},
        {id: 4, levelName: "Cấp 4", uciSkillLevel: 6, searchDepth: 10, maxMovetimeMs: 800},
        {id: 5, levelName: "Cấp 5", uciSkillLevel: 8, searchDepth: 12, maxMovetimeMs: 1000},
        {id: 6, levelName: "Cấp 6", uciSkillLevel: 10, searchDepth: 14, maxMovetimeMs: 1200},
        {id: 7, levelName: "Cấp 7", uciSkillLevel: 12, searchDepth: 16, maxMovetimeMs: 1500},
        {id: 8, levelName: "Cấp 8", uciSkillLevel: 14, searchDepth: 18, maxMovetimeMs: 1800},
        {id: 9, levelName: "Cấp 9", uciSkillLevel: 16, searchDepth: 20, maxMovetimeMs: 2000},
        {id: 10, levelName: "Cấp 10", uciSkillLevel: 18, searchDepth: 22, maxMovetimeMs: 2500},
        {id: 11, levelName: "Cấp 11", uciSkillLevel: 19, searchDepth: 24, maxMovetimeMs: 3000},
        {id: 12, levelName: "Cấp 12", uciSkillLevel: 20, searchDepth: 26, maxMovetimeMs: 3500}
    ], 
    human: [
        {id: 1, uciSkillLevel: 20, searchDepth: 6, maxMovetimeMs: 500, multiPVCount: 5, pvProbabilities: [0.10, 0.20, 0.20, 0.25, 0.25], maxCentipawnDrop: 400, maxBadScore: -600},
        {id: 2, uciSkillLevel: 20, searchDepth: 8, maxMovetimeMs: 600, multiPVCount: 5, pvProbabilities: [0.15, 0.20, 0.20, 0.20, 0.25], maxCentipawnDrop: 350, maxBadScore: -550},
        {id: 3, uciSkillLevel: 20, searchDepth: 10, maxMovetimeMs: 700, multiPVCount: 5, pvProbabilities: [0.20, 0.20, 0.20, 0.20, 0.20], maxCentipawnDrop: 300, maxBadScore: -500},
        {id: 4, uciSkillLevel: 20, searchDepth: 12, maxMovetimeMs: 800, multiPVCount: 4, pvProbabilities: [0.15, 0.25, 0.25, 0.35], maxCentipawnDrop: 250, maxBadScore: -400},
        {id: 5, uciSkillLevel: 20, searchDepth: 13, maxMovetimeMs: 900, multiPVCount: 4, pvProbabilities: [0.2, 0.25, 0.25, 0.30], maxCentipawnDrop: 200, maxBadScore: -350},
        {id: 6, uciSkillLevel: 20, searchDepth: 14, maxMovetimeMs: 1000, multiPVCount: 4, pvProbabilities: [0.25, 0.25, 0.25, 0.25], maxCentipawnDrop: 150, maxBadScore: -300},
        {id: 7, uciSkillLevel: 20, searchDepth: 16, maxMovetimeMs: 1300, multiPVCount: 3, pvProbabilities: [0.25, 0.35, 0.40], maxCentipawnDrop: 120, maxBadScore: -250},
        {id: 8, uciSkillLevel: 20, searchDepth: 17, maxMovetimeMs: 1500, multiPVCount: 3, pvProbabilities: [0.35, 0.35, 0.30], maxCentipawnDrop: 100, maxBadScore: -200},
        {id: 9, uciSkillLevel: 20, searchDepth: 18, maxMovetimeMs: 1800, multiPVCount: 3, pvProbabilities: [0.40, 0.30, 0.30], maxCentipawnDrop: 80, maxBadScore: -150},
        {id: 10, uciSkillLevel: 20, searchDepth: 22, maxMovetimeMs: 2500, multiPVCount: 2, pvProbabilities: [0.65, 0.35], maxCentipawnDrop: 50, maxBadScore: -100},
        {id: 11, uciSkillLevel: 20, searchDepth: 24, maxMovetimeMs: 3000, multiPVCount: 2, pvProbabilities: [0.85, 0.15], maxCentipawnDrop: 30, maxBadScore: -50},
        {id: 12, uciSkillLevel: 20, searchDepth: 26, maxMovetimeMs: 3500, multiPVCount: 1, pvProbabilities: [1.0], maxCentipawnDrop: 0, maxBadScore: 0}
    ] 
};

// =====================================================================
// FEATURE DETECTION
// =====================================================================
function checkThreads() { try { return typeof SharedArrayBuffer !== 'undefined'; } catch (e) { return false; } }
async function checkSIMD() {
    try {
        const simdWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
        return await WebAssembly.validate(simdWasm);
    } catch (e) { return false; }
}
async function checkRelaxedSIMD() {
    try {
        const relaxedSimdWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11]);
        return await WebAssembly.validate(relaxedSimdWasm);
    } catch (e) { return false; }
}
export function getDeviceTier() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return isMobile ? 'MOBILE' : 'PC';
}

export async function getBestEngineType() {
    const isMobile = getDeviceTier() === 'MOBILE';
    const threads = checkThreads();
    const simd = await checkSIMD();
    let relaxedSimd = false;

    if (!isMobile) relaxedSimd = await checkRelaxedSIMD();

    if (threads) {
        if (relaxedSimd) return 'multi_simd_relaxed';
        if (simd) return 'multi_simd';
        return 'multi';
    } else {
        if (simd) return 'single_simd';
        return 'single';
    }
}

// =====================================================================
// HỆ THỐNG SENTINEL (NGƯỜI CANH GÁC BỘ NHỚ - CHUẨN XIANGQIAI)
// =====================================================================
const SENTINEL_KEY = "tkv_sentinel_pending";
const SENTINEL_KILL_MIN = "tkv_sentinel_kill_min"; // Mốc Hash cao nhất gây crash

export const EngineSentinel = {
    armedInfo: null,
    heartbeatTimer: null,
    settleTimer: null,

    initLifecycle() {
        if (typeof window === 'undefined') return;
        window.addEventListener('pagehide', () => this.disarm());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.disarm();
        });
    },

    readPending() {
        try {
            const data = localStorage.getItem(SENTINEL_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) { return null; }
    },

    writePending(info) {
        this.armedInfo = info;
        try { localStorage.setItem(SENTINEL_KEY, JSON.stringify(info)); } catch (e) {}
    },

    getHashCeiling() {
        try {
            const killMin = Number(localStorage.getItem(SENTINEL_KILL_MIN));
            // Nếu có mốc Crash, trả về một nửa mốc đó, thấp nhất là 32MB
            if (killMin && killMin > 0) return Math.max(32, Math.floor(killMin / 2));
        } catch (e) {}
        return Infinity;
    },

    checkStartup(reqHash, reqThreads) {
        const pending = this.readPending();
        if (!pending) return { status: "clean" };

        localStorage.removeItem(SENTINEL_KEY);
        this.armedInfo = null;

        // Nếu lần trước bị crash
        const prevHash = pending.hash || reqHash;
        const prevThreads = pending.threads || reqThreads;

        // Tính toán cắt giảm theo công thức XiangqiAI
        let newHash = prevHash;
        let newThreads = prevThreads;
        let changed = false;

        if (prevHash > 64) {
            newHash = Math.max(64, Math.floor(prevHash / 2));
            changed = true;
            try { localStorage.setItem(SENTINEL_KILL_MIN, String(prevHash)); } catch (e) {}
        } else if (prevThreads > 1) {
            newThreads = prevThreads - 1;
            changed = true;
        }

        return {
            status: "kill",
            prevHash, prevThreads, newHash, newThreads, changed
        };
    },

    arm(hash, threads) {
        this.disarm();
        const info = { hash, threads, armedAt: Date.now() };
        this.writePending(info);
        
        // Nhịp tim 5s
        this.heartbeatTimer = setInterval(() => {
            if (this.armedInfo) {
                this.armedInfo.armedAt = Date.now();
                this.writePending(this.armedInfo);
            }
        }, 5000);
    },

    disarm() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.settleTimer) clearTimeout(this.settleTimer);
        this.heartbeatTimer = null;
        this.settleTimer = null;
        this.armedInfo = null;
        try { localStorage.removeItem(SENTINEL_KEY); } catch (e) {}
    },

    onReadyOk() {
        if (!this.armedInfo) return;
        // Đợi 5 giây xem Engine có sập không, nếu sống sót thì gỡ mìn
        if (this.settleTimer) clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => {
            console.log("✅ Sentinel: Engine sống sót an toàn. Gỡ mìn!");
            this.disarm();
        }, 5000);
    }
};

// Kích hoạt lắng nghe đóng Tab để không nhận nhầm là Crash
EngineSentinel.initLifecycle();


// =====================================================================
// KHỞI TẠO ĐỘNG CƠ & ÁP DỤNG GIỚI HẠN
// =====================================================================
function applyEngineHardwareLimits(type) {
    const isMobile = getDeviceTier() === 'MOBILE';
    const isSingle = type.includes('single');
    const isSimd = type.includes('simd');
    
    // 1. CHẠY SENTINEL CHECK (Kiểm tra có bị sập lần trước không)
    const startupStatus = EngineSentinel.checkStartup(state.aiSettings.hash, state.aiSettings.threads);
    if (startupStatus.status === 'kill' && startupStatus.changed) {
        console.warn(`🔥 Sentinel phát hiện Crash lần trước! Ép giảm cấu hình: Hash ${startupStatus.newHash}MB, Threads ${startupStatus.newThreads}`);
        state.aiSettings.hash = startupStatus.newHash;
        state.aiSettings.threads = startupStatus.newThreads;
        storage.saveAnalysis(state.aiSettings);
        showToast("⚠️ Trình duyệt bị tắt đột ngột do thiếu RAM. Đã tự động giảm cấu hình AI cho an toàn.");
    }

    // 2. THIẾT LẬP THREADS (LUỒNG)
    let maxThreads = 1;
    if (!isSingle) {
        maxThreads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 2;
        if (maxThreads > 16) maxThreads = 16;
    }
    
    if (state.aiSettings.threads > maxThreads) state.aiSettings.threads = maxThreads;

    const inputThreads = document.getElementById('input-threads');
    const descThreads = document.getElementById('desc-threads');
    if (inputThreads) {
        inputThreads.setAttribute('max', maxThreads);
        inputThreads.value = state.aiSettings.threads;
    }
    if (descThreads) {
        descThreads.innerText = isSingle ? `Tối đa: 1 luồng (Bản An toàn)` : `Tối đa: ${maxThreads} luồng`;
    }

    // 3. THIẾT LẬP HASH (BỘ NHỚ BĂM) THEO XIANGQIAI
    let maxHash = 64; 
    let defaultHash = 64;

    if (type === 'single') {
        maxHash = 64;
        defaultHash = 32;
    } else if (type === 'single_simd' || type === 'multi') {
        maxHash = 256;
        defaultHash = 64;
    } else {
        // multi_simd và multi_simd_relaxed
        maxHash = 512;
        defaultHash = isMobile ? 64 : 128;
    }

    // Bảo vệ các thiết bị RAM siêu yếu (Android cũ) nếu API tồn tại
    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
        maxHash = Math.min(maxHash, 64);
        defaultHash = 32;
    }
    
    // Sentinel Ceiling (Khống chế cứng nếu đã từng sập)
    const hashCeiling = EngineSentinel.getHashCeiling();
    if (maxHash > hashCeiling) maxHash = hashCeiling;

    if (state.aiSettings.hash > maxHash) state.aiSettings.hash = maxHash;

    const inputHash = document.getElementById('input-hash');
    if (inputHash) {
        inputHash.setAttribute('max', maxHash);
        if (!storage.getAnalysis() || !storage.getAnalysis().hash) {
            state.aiSettings.hash = defaultHash; 
        }
        inputHash.value = state.aiSettings.hash;
    }

    // 4. THIẾT LẬP ĐỘ SÂU (DEPTH) & LƯU LẠI
    let maxDepth = 255;
    const inputDepth = document.getElementById('input-depth');
    if (inputDepth) {
        inputDepth.setAttribute('max', maxDepth);
        if (state.aiSettings.depth > maxDepth) state.aiSettings.depth = maxDepth;
        inputDepth.value = state.aiSettings.depth;
    }
    
    storage.saveAnalysis(state.aiSettings); 

    // 5. ẨN/HIỆN NÚT "ĐI NGAY"
    const btnGoInstant = document.getElementById('btn-go-instant');
    if (btnGoInstant) btnGoInstant.style.display = isSingle ? 'none' : ''; 
}

export async function initPikafish(forceType = null) {
    const type = forceType || await getBestEngineType();
    currentWasmType = type;
    //console.log("🚀 Bắt đầu Khởi tạo Pikafish phiên bản:", type);

    applyEngineHardwareLimits(type);
    attachCrashHandlers();

    const basePath = window.location.href.replace(/\/[^\/]*$/, '');
    //console.log("Base Path:", basePath);

    EngineSentinel.arm(state.aiSettings.hash, state.aiSettings.threads);

    // -----------------------------------------------------------------
    // PHÂN LUỒNG 1: BẢN MULTI (DÙNG <SCRIPT> TẢI TRỰC TIẾP LÊN MAIN THREAD)
    // -----------------------------------------------------------------
    if (type.includes("multi")) {
        const scriptUrl = `${basePath}/engines/${type}/pikafish.js`;
        //console.log("Tải file script Multi tại:", scriptUrl);
        
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.onload = () => {
            //console.log("Script Multi đã tải xong, đang gọi window.Pikafish()");
            window.Pikafish({
                locateFile: function(path) {
                    let finalPath = path.endsWith('.data') ? `${basePath}/engines/${path}` : `${basePath}/engines/${type}/${path}`;
                    //console.log("LocateFile request:", path, "->", finalPath);
                    return finalPath;
                },
                onReceiveStdout: function(text) { handleEngineOutput(text); },
                print: function(text) { handleEngineOutput(text); },
                ALLOW_MEMORY_GROWTH: true
            }).then(function(module) {
                //console.log("Module Pikafish Multi khởi tạo THÀNH CÔNG!");
                currentEngineInstance = module;
                state.engineModule = {
                    sendCommand: (cmd) => {
                        console.log('%c[GUI -> ENGINE] ' + cmd, 'color: #1a73e8; font-weight: bold;');
                        if (typeof module.send_command === 'function') module.send_command(cmd);
                        else if (typeof module.sendCommand === 'function') module.sendCommand(cmd);
                    }
                };
                onEngineReady(type);
            }).catch(err => onEngineError("Lỗi Promise Pikafish() Multi: " + err));
        };
        script.onerror = (e) => onEngineError("Lỗi onload thẻ script: Không thể tải " + scriptUrl);
        document.head.appendChild(script);
    } 
    
    // -----------------------------------------------------------------
    // PHÂN LUỒNG 2: BẢN SINGLE (DÙNG BASE64 WORKER ĐỂ LÁCH CORS TRÊN ZALO/FB)
    // -----------------------------------------------------------------
    else {
        //console.log("Chuẩn bị tạo Base64 Worker cho bản Single...");
        const workerScript = `
            var EngineInstance = null;
            self.onmessage = function (e) {
                if (e.data.command != null) {
                    if(EngineInstance && typeof EngineInstance.send_command === 'function') EngineInstance.send_command(e.data.command);
                    else if(EngineInstance && typeof EngineInstance.sendCommand === 'function') EngineInstance.sendCommand(e.data.command);
                } else if (e.data.wasm_type != null) {
                    let wasmType = e.data.wasm_type;
                    let basePath = e.data.basePath;
                    let scriptToLoad = basePath + "/engines/" + wasmType + "/pikafish.js";
                    
                    self.postMessage({ debug: "Worker bắt đầu gọi importScripts: " + scriptToLoad });
                    
                    try {
                        self.importScripts(scriptToLoad);
                        self.postMessage({ debug: "Worker importScripts thành công!" });
                    } catch(err) {
                        self.postMessage({ error: "Lỗi importScripts trong Worker: " + err.toString() });
                        return;
                    }
                    
                    self['Pikafish']({
                        onReceiveStdout: (text) => self.postMessage({ stdout: text }),
                        print: (text) => self.postMessage({ stdout: text }),
                        locateFile: (url) => {
                            if (url === 'pikafish.data') return basePath + "/engines/" + url;
                            return basePath + "/engines/" + wasmType + "/" + url;
                        }
                    }).then(p => {
                        EngineInstance = p;
                        self.postMessage({ ready: true });
                    }).catch(err => {
                        self.postMessage({ error: "Lỗi Promise Pikafish() trong Worker: " + err.toString() });
                    });
                }
            }
        `;

        try {
            const blob = new Blob([workerScript], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            
            //console.log("Blob URL tạo thành công. Khởi tạo new Worker...");
            const engineWorker = new Worker(blobUrl, { type: "classic" });
            
            URL.revokeObjectURL(blobUrl);

            engineWorker.onerror = (err) => {
                console.error("Worker Object Error (Main Thread bắt được):", err.message || err);
                onEngineError("Worker Object Error: " + (err.message || err));
            };

            currentEngineInstance = engineWorker;

            state.engineModule = {
                sendCommand: (cmd) => {
                    console.log('%c[GUI -> ENGINE] ' + cmd, 'color: #1a73e8; font-weight: bold;');
                    engineWorker.postMessage({ command: cmd });
                }
            };

            engineWorker.onmessage = (e) => {
                if (e.data.debug) {
                    //console.log("[Worker Debug]:", e.data.debug);
                } else if (e.data.error) {
                    //console.error("[Worker Error Bắn về]:", e.data.error);
                    onEngineError(e.data.error);
                } else if (e.data.ready) {
                    console.log("Worker gửi tín hiệu READY!");
                    onEngineReady(type);
                } else if (e.data.stdout) {
                    handleEngineOutput(e.data.stdout);
                }
            };

            //console.log("Gửi lệnh init tới Worker...");
            engineWorker.postMessage({ wasm_type: type, basePath: basePath });
        } catch (e) {
            console.error("Lỗi bao ngoài khi khởi tạo Single Worker:", e);
            onEngineError("Lỗi khởi tạo Worker: " + e.toString());
        }
    }
}

function onEngineReady(type) {
    state.engineModule.sendCommand("uci");
    state.engineModule.sendCommand("setoption name Repetition Rule value AsianRule");
    state.engineModule.sendCommand("setoption name Sixty Move Rule value false");
    state.engineModule.sendCommand("isready");

    EngineSentinel.onReadyOk();
    
    const overlay = document.getElementById('loading-overlay');
    if (overlay) { 
        overlay.style.opacity = '0'; 
        setTimeout(() => { overlay.style.display = 'none'; }, 500); 
    }

    if (pendingAction) {
        if (state.appMode !== 'vsbot') {
            state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);
        }
        executePendingAction();
    } else {
        applyEngineSettings(); 
        //showToast(`✅ Tải AI thành công (Bản: ${type})`);
    }
}

function onEngineError(err) {
    console.error("Lỗi khởi tạo AI (Hàm onEngineError):", err);
    const overlay = document.getElementById('loading-overlay');
    if(overlay) overlay.innerHTML = `<h2 style='color:red; text-align:center;'>Lỗi tải Engine AI</h2><p style='text-align:center;'>${err.toString()}</p>`;
}
export function selectHumanLikeMove(parsedMultiPVList, currentLevelData) {
    if (!parsedMultiPVList || parsedMultiPVList.length === 0) return null;
    
    const pv1 = parsedMultiPVList[0];
    
    // 1. CHỐNG BỎ LỠ SÁT CỤC: Nếu có cơ hội chiếu bí, đi ngay lập tức
    if (pv1.isMate || parsedMultiPVList.some(pv => pv.isMate)) {
        return pv1.move;
    }

    // 2. NGOẠI LỆ: Nếu bản thân PV1 đã vượt quá giới hạn "Điểm xấu tối đa" 
    if (pv1.cp < currentLevelData.maxBadScore) {
        return pv1.move; 
    }

    // 3. LỌC CÁC NƯỚC ĐI ĐẠT CHUẨN VÀ TÍNH TỔNG XÁC SUẤT GỐC CỦA CHÚNG
    let validMoves = [];
    let sumValidProbs = 0.0;
    const probs = currentLevelData.pvProbabilities;

    for (let i = 0; i < parsedMultiPVList.length; i++) {
        if (i >= probs.length) break; // Đề phòng lỗi thiếu mảng

        const pv = parsedMultiPVList[i];
        const baseProb = probs[i];

        // Chỉ giữ lại những nước có điểm số lớn hơn hoặc bằng maxBadScore
        if (pv.cp >= currentLevelData.maxBadScore) {
            validMoves.push({ pv: pv, baseProb: baseProb });
            sumValidProbs += baseProb;
        }
    }

    // Fallback an toàn (Mặc dù logic ở bước 2 đã chặn trường hợp mảng rỗng)
    if (validMoves.length === 0) return pv1.move;

    // 4. QUAY XÚC XẮC VỚI XÁC SUẤT MỚI ĐÃ ĐƯỢC CHUẨN HÓA (Proportional Redistribution)
    let roll = Math.random(); 
    let cumulative = 0.0; 
    let selectedPv = validMoves[validMoves.length - 1].pv; // Mặc định là biến cuối cùng

    for (let i = 0; i < validMoves.length; i++) {
        // Trọng số mới = Xác suất gốc / Tổng xác suất của các PV hợp lệ
        let newProb = validMoves[i].baseProb / sumValidProbs;
        cumulative += newProb;

        if (roll <= cumulative) { 
            selectedPv = validMoves[i].pv; 
            break; 
        }
    }

    // 5. CHỐNG ĐI LỖI TƯƠNG ĐỐI (Max Centipawn Drop), Nếu nước vừa quay trúng lại bị chênh lệch quá lớn so với nước tốt nhất (PV1)
    const cpDrop = pv1.cp - selectedPv.cp; 
    if (cpDrop > currentLevelData.maxCentipawnDrop) {
        selectedPv = pv1; 
    }
    
    return selectedPv.move;
}

// BỘ LỌC CHIẾN THUẬT: TẤN CÔNG / PHÒNG THỦ (MÔ PHỎNG THUẬT TOÁN PIKAFISH)
export function selectTacticalStyleMove(pvLines, currentFen, tacticsValue, fallbackMove) {
    if (!pvLines || pvLines.length === 0) return fallbackMove;
    
    const validLines = pvLines.filter(p => p && p.bestMove);
    if (validLines.length <= 1) return fallbackMove;

    const topScore = (validLines[0].relativeScore !== undefined) ? validLines[0].relativeScore : 0;
    // Chỉ chọn trong các nước đi có điểm chênh lệch không quá 65 centipawns so với nước tối ưu nhất
    const viableMoves = validLines.filter(p => Math.abs(topScore - (p.relativeScore || 0)) <= 65);
    if (viableMoves.length <= 1) return fallbackMove;

    const isRedTurn = currentFen.split(" ")[1] === "w";
    const fenParts = currentFen.split(" ");
    const boardRows = fenParts[0].split("/");
    let board = [];
    for (let r = 0; r < 10; r++) {
        let cols = [];
        for (let c = 0; c < boardRows[r].length; c++) {
            let ch = boardRows[r][c];
            if (!isNaN(ch)) { for (let i = 0; i < parseInt(ch); i++) cols.push('*'); }
            else { cols.push(ch); }
        }
        board.push(cols);
    }

    if (tacticsValue <= 3) {
        // PHÒNG THỦ: Củng cố sĩ tượng, giữ vững trận hình, lùi về phòng thủ an toàn
        let bestDefMove = viableMoves[0].bestMove;
        let maxDefScore = -9999;

        for (let item of viableMoves) {
            const move = item.bestMove;
            if (!move || move.length < 4) continue;
            const fromX = move.charCodeAt(0) - 97;
            const fromY = 9 - parseInt(move.charAt(1));
            const toX = move.charCodeAt(2) - 97;
            const toY = 9 - parseInt(move.charAt(3));
            const piece = board[fromY] ? board[fromY][fromX] : '*';
            const target = board[toY] ? board[toY][toX] : '*';
            const kind = piece.toUpperCase();

            let score = 0;
            // Củng cố Sĩ Tượng (A: Sĩ, B: Tượng)
            if (kind === 'A' || kind === 'B') score += 35;
            // Lùi về giữ trận (Red lùi: toY < fromY, Black lùi: toY > fromY)
            if (isRedTurn ? (toY < fromY) : (toY > fromY)) score += 25;
            // Giữ ở phần sân nhà an toàn (Red: toY <= 4, Black: toY >= 5)
            if (isRedTurn ? (toY <= 4) : (toY >= 5)) score += 15;
            // Bắt quân an toàn
            if (target !== '*') score += 15;

            if (score > maxDefScore) {
                maxDefScore = score;
                bestDefMove = move;
            }
        }
        return bestDefMove;
    } else if (tacticsValue >= 7) {
        // TẤN CÔNG: Lao lên phần sân đối phương, chiếm lộ trọng yếu, bắt quân
        let bestAtkMove = viableMoves[0].bestMove;
        let maxAtkScore = -9999;

        for (let item of viableMoves) {
            const move = item.bestMove;
            if (!move || move.length < 4) continue;
            const fromX = move.charCodeAt(0) - 97;
            const fromY = 9 - parseInt(move.charAt(1));
            const toX = move.charCodeAt(2) - 97;
            const toY = 9 - parseInt(move.charAt(3));
            const piece = board[fromY] ? board[fromY][fromX] : '*';
            const target = board[toY] ? board[toY][toX] : '*';

            let score = 0;
            // Tiến công về phía đối phương (Red tiến: toY > fromY, Black tiến: toY < fromY)
            if (isRedTurn ? (toY > fromY) : (toY < fromY)) score += 30;
            // Sang phần sân đối phương / qua sông (Red: toY >= 5, Black: toY <= 4)
            if (isRedTurn ? (toY >= 5) : (toY <= 4)) score += 25;
            // Bắt quân đối phương
            if (target !== '*') score += 35;
            // Chiếm trung lộ hoặc sườn cung (cột d, e, f tức lộ 4, 5, 6 - index 3, 4, 5)
            if (toX >= 3 && toX <= 5) score += 20;

            if (score > maxAtkScore) {
                maxAtkScore = score;
                bestAtkMove = move;
            }
        }
        return bestAtkMove;
    }

    return fallbackMove;
}

export function applyEngineSettings() {
    if (!state.engineModule) return;
    pendingAction = 'eval';
    handleStateTransition(); 
}

let currentCloudFetchId = 0;
export async function fetchCloudBook(fen) {
    const isRedTurn = fen.split(" ")[1] === "w";
    const isAITurn = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

    if (isAITurn && (state.appMode === 'puzzle' || state.appMode === 'memorize')) {
        triggerEngineOnly();
        return;
    }

    const container = document.getElementById('cloudbook-list-container');
    if (!container) return;

    // --- KIỂM TRA CHẾ ĐỘ BOOK ---
    const bookType = state.appSettings.bookType || 'cloud';

    if (bookType === 'local') {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Đang tìm trong Local Book...</div>';
        
        // Gọi Worker Wasm!
        const localMoves = await queryLocalBookWorker(fen);
        
        // NẾU WORKER TRẢ VỀ TÍN HIỆU ĐANG NẠP VÀO RAM
        if (localMoves === 'LOADING') {
            container.innerHTML = '<div style="text-align: center; color: #1a73e8; margin-top: 10px;">⏳ Đang nạp Local Book vào RAM...</div>';
            return;
        }
        
        // YÊU CẦU 2: NẾU CHƯA CÓ FILE LOCAL BOOK TRONG MÁY
        if (localMoves === 'NO_DB') {
            container.innerHTML = '<div style="text-align: center; color: #d32f2f; margin-top: 15px; line-height: 1.5;">Chưa có dữ liệu Local Book<br><span style="font-size: 12px; color: #666; font-weight: normal;">Vui lòng vào <b>Cài đặt</b> ⚙️ để tải lên tệp</span></div>';
            if (isAITurn) triggerEngineOnly();
            return;
        }
        
        handleBookResults(localMoves, isAITurn, isRedTurn, container, fen);
        return;
    }

    // --- XỬ LÝ CLOUD BOOK BÌNH THƯỜNG ---
    
    // YÊU CẦU 1: KHI OFFLINE, XÓA DỮ LIỆU CŨ VÀ BÁO LỖI
    if (!navigator.onLine) {
        container.innerHTML = '<div style="text-align: center; color: #d32f2f; margin-top: 15px;">❌ Không có kết nối mạng để tải Cloud Book</div>';
        if (isAITurn) setTimeout(() => triggerEngineOnly(), 10);
        return; 
    }
    
    const fetchId = ++currentCloudFetchId;
    container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Đang tải dữ liệu Cloud...</div>';
    let shortFen = fen.split(" ").slice(0, 2).join(" ");
    let url = `https://www.chessdb.cn/chessdb.php?action=queryall&board=${encodeURIComponent(shortFen)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    fetch(url, { signal: controller.signal }).then(res => {
        clearTimeout(timeoutId);
        return res.text();
    }).then(text => {
        if (fetchId !== currentCloudFetchId) return;
        
        let isValidCloudData = text && !text.includes("unknown") && !text.includes("invalid");
        let parsedMoves = [];
        
        if (isValidCloudData) {
            let moves = text.split('|');
            moves.forEach(mStr => {
                let parts = mStr.split(','); let moveObj = {};
                parts.forEach(p => { let [k, v] = p.split(':'); moveObj[k] = v; });
                if (moveObj.move) parsedMoves.push(moveObj);
            });
        }
        
        handleBookResults(parsedMoves, isAITurn, isRedTurn, container, fen);
        
    }).catch(err => {
        if (fetchId !== currentCloudFetchId) return;
        container.innerHTML = '<div style="text-align: center; color: #d32f2f; margin-top: 10px;">❌ Lỗi kết nối máy chủ CloudDB</div>';
        if (isAITurn) triggerEngineOnly();
    });
}

// --- HÀM RENDER & XỬ LÝ CHUNG CHO CẢ CLOUD VÀ LOCAL ---
function handleBookResults(movesList, isAITurn, isRedTurn, container, fen) {
    const currentRoundNum = parseInt(fen.split(" ")[5]) || 1;
    let effectiveCloudLimit = state.appSettings.cloudBookLimit || 10;
    const canUseBook = state.appSettings.cloudBookEnabled && (currentRoundNum <= effectiveCloudLimit);

    // TRƯỜNG HỢP 1: Lượt AI và có sách hợp lệ
    if (isAITurn && canUseBook && movesList.length > 0) {
        let bestMove = movesList[0].move;

        // Chọn nước đi theo phong cách chiến thuật (Công - Thủ) nếu có nhiều nước đi trong Book
        const style = (state.appMode === 'vsbot') ? state.vsBotSettings.botStyle : (state.aiSettings.botStyle || 'standard');
        const tacticsVal = (state.appMode === 'vsbot') ? 
            (state.vsBotSettings.tacticsValue !== undefined ? state.vsBotSettings.tacticsValue : 5) : 
            (state.aiSettings.tacticsValue !== undefined ? state.aiSettings.tacticsValue : 5);

        if (movesList.length > 1 && (tacticsVal <= 3 || tacticsVal >= 7 || style === 'attack' || style === 'defense')) {
            const pvCandidates = movesList.map(m => ({
                bestMove: m.move,
                relativeScore: parseInt(m.score) || (parseFloat(m.winrate) ? Math.round((parseFloat(m.winrate) - 50) * 10) : 0)
            }));
            const chosenMove = selectTacticalStyleMove(pvCandidates, fen, tacticsVal, movesList[0].move);
            if (chosenMove) bestMove = chosenMove;
        } else if (movesList.length > 1 && style === 'human') {
            const topMoves = movesList.slice(0, 3);
            bestMove = topMoves[Math.floor(Math.random() * topMoves.length)].move;
        }

        if (getStrictLegalMoves(state.currentSituation, state.currentNode.fen).includes(bestMove)) {
            // Độ trễ tự nhiên (300ms) để ván cờ cực nhanh, mượt mà, không chờ đợi 3s
            const delayMs = 300;
            showAILoading();
            
            clearTimeout(cloudBookTimeoutId);
            cloudBookTimeoutId = setTimeout(() => { 
                const isRedTurnNow = state.currentNode.fen.split(" ")[1] === "w";
                const willAIOperate = (isRedTurnNow && state.aiPlaysRed) || (!isRedTurnNow && state.aiPlaysBlack);
                if (willAIOperate) {
                    hideAILoading();
                    executeMove(bestMove); 
                } else {
                    hideAILoading();
                }
            }, delayMs); 
            return;
        }
    }

    // TRƯỜNG HỢP 2: Lượt AI mà hết sách -> Chạy Pikafish
    if (isAITurn) triggerEngineOnly();

    // HIỂN THỊ DANH SÁCH LÊN UI
    if (movesList.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Không có dữ liệu khai cuộc</div>';
        return;
    }
    
    container.innerHTML = ''; 
    let headerBtn = document.createElement('div'); headerBtn.className = 'cloud-btn cloud-header';
    let spanHeaderMove = document.createElement('span'); spanHeaderMove.innerText = 'Nước Đi';
    let spanHeaderScore = document.createElement('span'); spanHeaderScore.innerText = isRedTurn ? 'Điểm Bên Đỏ' : 'Điểm Bên Đen';
    headerBtn.appendChild(spanHeaderMove); headerBtn.appendChild(spanHeaderScore); container.appendChild(headerBtn);
    
    movesList.forEach(moveObj => {
        let isPositive = true; let scoreText = "0";
        if (moveObj.score !== undefined) {
            let score = parseInt(moveObj.score); isPositive = score >= 0; scoreText = (isPositive ? '+' : '') + score;
        } else if (moveObj.winrate !== undefined) {
            let wr = parseFloat(moveObj.winrate); isPositive = wr >= 50.0; scoreText = `${wr}%`; 
        }
        
        // Import module game.js -> customTranslator để dịch sang tiếng Việt
        import('./game.js').then(({ customTranslator }) => {
            let notation = customTranslator(moveObj.move, fen) || moveObj.move;
            let btn = document.createElement('button'); btn.className = `cloud-btn ${isPositive ? 'cloud-blue' : 'cloud-red'}`;
            let spanMove = document.createElement('span'); spanMove.innerText = notation;
            let spanScore = document.createElement('span'); spanScore.innerText = scoreText;
            btn.appendChild(spanMove); btn.appendChild(spanScore);
            btn.onclick = () => {
                if (getStrictLegalMoves(state.currentSituation, state.currentNode.fen).includes(moveObj.move)) { executeMove(moveObj.move); } 
                else { showToast("⚠️ Nước đi này bị cấm do luật lặp lại!"); }
            };
            container.appendChild(btn);
        });
    });
}

export function triggerEngineEvaluation() {
    if (!state.engineModule || state.isEditMode || state.isChartRunning || state.isChartDrawing) return;
    pendingAction = 'eval';
    handleStateTransition();
}

export function triggerHintEvaluation() {
    if (!state.engineModule || state.isAnimating || state.isAutoPlaying) return;
    pendingAction = 'hint';
    handleStateTransition();
}

export function triggerAnalyzeOnly() {
    if (!state.engineModule || state.isAnimating || state.isAutoPlaying) return;
    pendingAction = 'analyze';
    handleStateTransition();
}

function handleStateTransition() {
    clearTimeout(cloudBookTimeoutId); 
    
    if (isEngineSearching) {
        // KIỂM TRA NẾU ĐANG CHẠY SINGLE THREAD TRÊN WORKER
        if (currentEngineInstance instanceof Worker) {
            //console.log("Single-thread bị block, đang tiêu diệt và hồi sinh Worker...");
            currentEngineInstance.terminate(); // Giết Worker cũ
            currentEngineInstance = null;
            state.engineModule = null;
            isEngineSearching = false;
            
            // Khởi tạo lại Worker mới (Hàm onEngineReady sẽ tự gọi executePendingAction khi xong)
            initPikafish(currentWasmType);
        } else {
            // ĐA LUỒNG XỬ LÝ BÌNH THƯỜNG
            state.engineModule.sendCommand("stop");
            clearTimeout(stopTimeoutId);
            stopTimeoutId = setTimeout(() => {
                if (pendingAction) {
                    isEngineSearching = false;
                    executePendingAction();
                }
            }, 150);
        }
    } else {
        executePendingAction();
    }
}

function executePendingAction() {
    const action = pendingAction;
    pendingAction = null; 
    clearTimeout(stopTimeoutId); 

    setTimeout(() => {
        if (action === 'eval') {
            const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
            const willAIPlay = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

            if (!willAIPlay && state.isAnalyzing) {
                triggerEngineOnly();
            }
            fetchCloudBook(state.currentNode.fen);
        }
        else if (action === 'hint') {
            const style = state.vsBotSettings.botStyle;
            const tacticsVal = state.vsBotSettings.tacticsValue !== undefined ? state.vsBotSettings.tacticsValue : 5;
            let contempt = 0;
            if (tacticsVal <= 5) contempt = Math.round(-50 + (tacticsVal / 5.0) * 50);
            else contempt = Math.round(((tacticsVal - 5) / 5.0) * 80);
            try { state.engineModule.sendCommand(`setoption name Contempt value ${contempt}`); } catch (e) {}

            let profile = (style === 'human') ? botProfiles.human[9] : botProfiles.standard[9];

            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            state.engineModule.sendCommand(`setoption name MultiPV value 1`); 
            state.pvLines = []; clearArrow(); renderMultiPVList();

            const historyStr = getMoveHistoryString(state.currentNode);
            if (historyStr.length > 0) {
                state.engineModule.sendCommand(`position fen ${state.rootNode.fen} moves ${historyStr}`);
            } else {
                state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
            }
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
            isEngineSearching = true; 
        }
        else if (action === 'analyze') {
            state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);

            state.pvLines = []; clearArrow(); renderMultiPVList();

            const historyStr = getMoveHistoryString(state.currentNode);
            if (historyStr.length > 0) {
                state.engineModule.sendCommand(`position fen ${state.rootNode.fen} moves ${historyStr}`);
            } else {
                state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
            }
                        
            state.engineModule.sendCommand(`go infinite`);
            isEngineSearching = true; 
        }
        else if (action === 'go_instant') {
            const historyStr = getMoveHistoryString(state.currentNode);
            if (historyStr.length > 0) {
                state.engineModule.sendCommand(`position fen ${state.rootNode.fen} moves ${historyStr}`);
            } else {
                state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
            } 
            state.engineModule.sendCommand("go movetime 100"); 
            isEngineSearching = true;
        }
        else if (action === 'start_chart') {
            if (state.rootNode && state.rootNode.children.length > 0) {
                chartCurrentNode = state.rootNode.children[state.rootNode.mainLineIndex] || state.rootNode.children[0];
                if (chartCurrentNode) analyzeNextChartNode();
            }
        }
    }, 10);
}

function triggerEngineOnly() {
    if (!state.engineModule || state.isAnimating || state.isEditMode || state.isAutoPlaying) return;
    const strictMoves = getStrictLegalMoves(state.currentSituation, state.currentNode.fen);
    if (strictMoves.length === 0) return;

    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    const willAIPlay = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

    const style = (state.appMode === 'vsbot') ? state.vsBotSettings.botStyle : (state.aiSettings.botStyle || 'standard');
    const tacticsVal = (state.appMode === 'vsbot') ? 
        (state.vsBotSettings.tacticsValue !== undefined ? state.vsBotSettings.tacticsValue : 5) : 
        (state.aiSettings.tacticsValue !== undefined ? state.aiSettings.tacticsValue : 5);

    // Ánh xạ mức độ Công - Thủ sang Contempt (-50 đến +80) cho TẤT CẢ các chế độ
    let contempt = 0;
    if (tacticsVal <= 5) {
        contempt = Math.round(-50 + (tacticsVal / 5.0) * 50);
    } else {
        contempt = Math.round(((tacticsVal - 5) / 5.0) * 80);
    }
    try { state.engineModule.sendCommand(`setoption name Contempt value ${contempt}`); } catch (e) {}

    if (state.appMode !== 'vsbot') {
        state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
        const searchPV = (willAIPlay && (tacticsVal <= 3 || tacticsVal >= 7 || style === 'attack' || style === 'defense')) ? 
                         Math.max(3, state.aiSettings.multiPV || 1) : (state.aiSettings.multiPV || 1);
        state.engineModule.sendCommand(`setoption name MultiPV value ${searchPV}`);
    }

    state.pvLines = []; clearArrow(); renderMultiPVList();

    const historyStr = getMoveHistoryString(state.currentNode);
    if (historyStr.length > 0) {
        state.engineModule.sendCommand(`position fen ${state.rootNode.fen} moves ${historyStr}`);
    } else {
        state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
    }

    if (state.appMode === 'vsbot' && willAIPlay) {
        const levelIdx = state.vsBotSettings.level - 1;
        let profile;
        if (style === 'human') {
            profile = botProfiles.human[levelIdx];
            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${profile.multiPVCount}`);
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
        } else {
            profile = botProfiles.standard[levelIdx];
            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            const searchPV = (tacticsVal <= 3 || tacticsVal >= 7 || style === 'attack' || style === 'defense') ? 3 : 1;
            state.engineModule.sendCommand(`setoption name MultiPV value ${searchPV}`);
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
        }
        isEngineSearching = true; 
        showAILoading(); 
    } 
    else {
        if (willAIPlay) {
            const moveTimeMs = Math.floor(state.aiSettings.moveTime * 1000);
            state.engineModule.sendCommand(`go depth ${state.aiSettings.depth} movetime ${moveTimeMs}`);
            isEngineSearching = true; 
            showAILoading(); 
        } else if (state.isAnalyzing) {
            state.engineModule.sendCommand(`go infinite`);
            isEngineSearching = true; 
        }
    }
}

function renderMultiPVList() {
    const container = document.getElementById("multipv-list-container");
    if (!container) return;
    if (state.pvLines.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Chưa có dữ liệu phân tích</div>';
        return;
    }
    let html = ''; const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    const colorText = isRedTurn ? "Điểm Đỏ" : "Điểm Đen";
    state.pvLines.forEach(line => {
        if (!line) return;
        const notation = customTranslator(line.bestMove, state.currentNode.fen) || line.bestMove;
        let npsStr = line.nps ? line.nps.toLocaleString() : "0";
        let timeStr = line.time ? (line.time / 1000).toFixed(1) + "s" : "0.0s";
        let scoreStr = line.scoreText || "0";
        let blockColor = (line.relativeScore >= 0) ? "#1a73e8" : "#d32f2f";
        let winRateStr = calculateWinRatePercentage(line.relativeScore);

        // Hiển thị toàn bộ biến tính toán của engine theo ký hiệu tiếng Việt
        let pvVietnamese = "";
        if (line.pvMoves && line.pvMoves.length > 0) {
            pvVietnamese = formatPvSequenceVietnamese(line.pvMoves, state.currentNode.fen, 10);
        }
        if (!pvVietnamese && notation) {
            pvVietnamese = notation;
        }

        html += `
            <div class="multipv-item" data-move="${line.bestMove}" style="color: ${blockColor}; cursor: pointer;">
                <div class="multipv-header">
                    <span>Biến số ${line.rank}</span>
                    <span class="multipv-bestmove">${notation}</span>
                </div>
                <div class="multipv-details" style="color: inherit; margin-top: 2px;">
                    <span>Tỉ lệ thắng:</span>
                    <span style="font-weight: bold; font-size: 14.5px;">${winRateStr}</span>
                </div>
                <div class="multipv-details" style="color: inherit;">
                    <span>${colorText}: <strong>${scoreStr}</strong></span>
                    <span>Độ sâu: ${line.depth || 0}</span>
                </div>
                <div class="multipv-details" style="color: inherit;">
                    <span>Thời gian: ${timeStr}</span>
                    <span>NPS: ${npsStr}</span>
                </div>
                ${pvVietnamese ? `
                <div class="multipv-pv-seq" style="margin-top: 8px; padding: 7px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #1a73e8; border-radius: 4px; font-size: 13px; font-family: monospace, sans-serif; font-weight: 600; line-height: 1.5; color: #0f172a; word-break: break-word;">
                    <span style="font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 3px;">Ký hiệu tiếng Việt:</span>
                    ${pvVietnamese}
                </div>` : ''}
            </div>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.multipv-item').forEach(item => {
        item.onclick = () => {
            const m = item.getAttribute('data-move');
            if (m && state.appMode === 'analyze' && !state.isAutoPlaying && !state.isAnimating) {
                if (getStrictLegalMoves(state.currentSituation, state.currentNode.fen).includes(m)) {
                    executeMove(m);
                }
            }
        };
    });
}

export function handleEngineOutput(text) {
    if (!text.startsWith("info")) {
        console.log('%c[ENGINE -> GUI] ' + text, 'color: #008a3e;');
    }
    if (state.isChartRunning) {
        if (text.includes("score cp")) {
            const cpMatch = text.match(/score cp (-?\d+)/);
            if (cpMatch) {
                chartLatestCP = parseInt(cpMatch[1]);
                chartLatestMate = null;
            }
        }
        if (text.includes("score mate")) {
            const mateMatch = text.match(/score mate (-?\d+)/);
            if (mateMatch) {
                chartLatestMate = parseInt(mateMatch[1]);
                chartLatestCP = null;
            }
        }

        if (text.startsWith("bestmove")) {
            if (chartTimerId) {
                clearTimeout(chartTimerId);
                chartTimerId = null;
            }
            isEngineSearching = false;

            if (!chartCurrentNode) return;

            const parts = text.split(" ");
            const bestMoveStr = parts[1] && parts[1] !== "(none)" ? parts[1].trim() : null;

            const isRedTurnNow = chartCurrentNode.fen.split(" ")[1] === "w";
            const rawScoreObj = { cp: chartLatestCP, mate: chartLatestMate };
            const rawNorm = normalizeScore(rawScoreObj);
            const absoluteScore = isRedTurnNow ? rawNorm : -rawNorm;

            chartCurrentNode.scoreObj = rawScoreObj;
            chartCurrentNode.normalizedScore = absoluteScore;
            chartCurrentNode.aiBestMove = bestMoveStr;

            if (chartCurrentNode.parent && chartCurrentNode.parent.normalizedScore !== null) {
                const bestScore = chartCurrentNode.parent.normalizedScore;
                const playedScore = absoluteScore;
                const turnColor = chartCurrentNode.parent.fen.split(" ")[1]; // w hoặc b
                
                const moveScore = evaluateMoveScore(bestScore, playedScore, turnColor);

                const isMissedWin = (turnColor === 'w' && bestScore >= 29000 && playedScore < 29000) || 
                                    (turnColor === 'b' && bestScore <= -29000 && playedScore > -29000);

                chartCurrentNode.moveScore = moveScore;
                chartCurrentNode.classification = classifyMove(moveScore, isMissedWin);
            }

            const graphScore = Math.max(-2000, Math.min(2000, absoluteScore));
            const isRedMoved = !isRedTurnNow;
            
            if (chartCurrentNode !== state.rootNode) {
                addChartPoint(graphScore, isRedMoved, chartCurrentNode.classification);
            }

            if (chartCurrentNode.children.length > 0) {
                chartCurrentNode = chartCurrentNode.children[chartCurrentNode.mainLineIndex];
                
                chartLatestCP = null;
                chartLatestMate = null;

                setTimeout(() => {
                    if (state.isChartDrawing) analyzeNextChartNode(); 
                }, 100); 
            } else {
                import('./events.js').then(ev => ev.finishChartDrawing());
            }
        }
        return; // ÉP RETURN ĐỂ BỎ QUA CODE NORMAL PHÍA DƯỚI
    }

    if (text.startsWith("info depth")) {
        const depthMatch = text.match(/depth (\d+)/);
        const scoreCpMatch = text.match(/score cp (-?\d+)/);
        const scoreMateMatch = text.match(/score mate (-?\d+)/);
        const timeMatch = text.match(/time (\d+)/);
        const npsMatch = text.match(/nps (\d+)/);
        const multipvMatch = text.match(/multipv (\d+)/);

        const pvIndex = text.indexOf(" pv ");
        let pvMoves = [];
        if (pvIndex !== -1) {
            const rawPv = text.substring(pvIndex + 4).trim();
            pvMoves = rawPv.split(/\s+/).filter(m => /^[a-i][0-9][a-i][0-9]$/.test(m));
        }

        let rank = multipvMatch ? parseInt(multipvMatch[1]) : 1;
        let isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
        let turnPrefix = isRedTurn ? "Điểm Đỏ: " : "Điểm Đen: "; 
        let scoreText = "0"; let finalScoreForBar = 0; let relativeScore = 0;    

        if (scoreCpMatch) {
            let cp = parseInt(scoreCpMatch[1]); relativeScore = cp; 
            scoreText = (relativeScore > 0 ? "+" : "") + relativeScore;
            if (relativeScore === 0) scoreText = "0";
            finalScoreForBar = isRedTurn ? cp : -cp;
        } 
        else if (scoreMateMatch) {
            let mate = parseInt(scoreMateMatch[1]); relativeScore = mate > 0 ? 10000 : -10000;
            scoreText = `chiếu hết(${mate > 0 ? '+' : '-'}${Math.abs(mate)})`;
            finalScoreForBar = (isRedTurn && mate > 0) || (!isRedTurn && mate < 0) ? 2000 : -2000;
        }

        if (pvMoves.length > 0) {
            state.pvLines[rank - 1] = {
                rank: rank, bestMove: pvMoves[0], ponderMove: pvMoves[1] || null,
                pvMoves: pvMoves,
                scoreText: scoreText, relativeScore: relativeScore, 
                depth: depthMatch ? parseInt(depthMatch[1]) : 0, time: timeMatch ? parseInt(timeMatch[1]) : 0, nps: npsMatch ? parseInt(npsMatch[1]) : 0
            };
            const now = Date.now();
            if (now - lastUiUpdateTime > 120) {
                if (rank === 1) {
                    const scoreBarFill = document.getElementById("score-bar-fill");
                    const scoreTextEl = document.getElementById("score-text");
                    if (scoreCpMatch) {
                        let winRate = 50 + (finalScoreForBar / 20); 
                        if (winRate > 100) winRate = 100; if (winRate < 0) winRate = 0;
                        if (scoreBarFill) scoreBarFill.style.width = `${winRate}%`;
                        if (scoreTextEl) scoreTextEl.innerText = turnPrefix + scoreText;
                    } else if (scoreMateMatch) {
                        let isRedWin = (isRedTurn && relativeScore > 0) || (!isRedTurn && relativeScore < 0);
                        if (scoreBarFill) scoreBarFill.style.width = isRedWin ? `100%` : `0%`;
                        if (scoreTextEl) scoreTextEl.innerText = turnPrefix + scoreText;
                    }
                }
                renderMultiPVList(); 
                drawBestMoveArrow();
                lastUiUpdateTime = now;
            }
        }
    } 
    
    else if (text.startsWith("bestmove")) {
        isEngineSearching = false;

        const scoreBarFill = document.getElementById("score-bar-fill");
        const scoreTextEl = document.getElementById("score-text");
        if (state.pvLines.length > 0 && state.pvLines[0]) {
            const line1 = state.pvLines[0];
            const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
            const turnPrefix = isRedTurn ? "Điểm Đỏ: " : "Điểm Đen: ";
            if (scoreTextEl) scoreTextEl.innerText = turnPrefix + line1.scoreText;
            if (scoreBarFill) {
                let winRate = 50 + ((isRedTurn ? line1.relativeScore : -line1.relativeScore) / 20);
                if (winRate > 100) winRate = 100; if (winRate < 0) winRate = 0;
                scoreBarFill.style.width = `${winRate}%`;
            }
        }

        renderMultiPVList();
        drawBestMoveArrow();

        const wasHintAction = (pendingAction === 'hint');

        if (pendingAction) {
            executePendingAction();
            if (wasHintAction) {
                const hintNotation = customTranslator(bestMove, state.currentNode.fen) || bestMove;
                showToast(`💡 Gợi ý của AI: ${hintNotation}`);
            }
            return; 
        }

        if (state.isAutoPlaying || state.isAnimating) return;
        const parts = text.split(" "); 
        const bestMove = parts[1] ? parts[1].trim() : "";
        
        if (bestMove === '(none)' || bestMove === 'none' || bestMove === '') {
            state.pvLines = []; clearArrow(); renderMultiPVList(); 
            hideAILoading();
            return;
        }

        const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
        
        if (state.appMode === 'vsbot' && !((isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack))) {
            state.pendingAIMove = bestMove; 
            hideAILoading();
            return;
        }

        if ((isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack)) {
            const style = (state.appMode === 'vsbot') ? state.vsBotSettings.botStyle : (state.aiSettings.botStyle || 'standard');
            const tacticsVal = (state.appMode === 'vsbot') ? 
                (state.vsBotSettings.tacticsValue !== undefined ? state.vsBotSettings.tacticsValue : 5) :
                (state.aiSettings.tacticsValue !== undefined ? state.aiSettings.tacticsValue : 5);

            if (style === 'human') {
                const levelIdx = (state.appMode === 'vsbot') ? (state.vsBotSettings.level - 1) : 9;
                const currentLevelData = botProfiles.human[levelIdx] || botProfiles.human[9];
                let parsedMultiPVList = state.pvLines.filter(p => p).map(p => ({
                    move: p.bestMove, cp: p.relativeScore, isMate: p.scoreText && p.scoreText.includes('chiếu hết')
                }));
                parsedMultiPVList.sort((a, b) => b.cp - a.cp);
    
                const resultMove = selectHumanLikeMove(parsedMultiPVList, currentLevelData);

                state.pendingAIMove = resultMove ? resultMove : bestMove; 
                hideAILoading();
            } else if (tacticsVal <= 3 || tacticsVal >= 7 || style === 'attack' || style === 'defense') {
                const tacticalMove = selectTacticalStyleMove(state.pvLines, state.currentNode.fen, tacticsVal, bestMove);
                state.pendingAIMove = tacticalMove || bestMove;
                hideAILoading();
            } else {
                state.pendingAIMove = bestMove;
                hideAILoading();
            }
        } else {
            hideAILoading();
        }
    }
}
}

// =====================================================================
// HỆ THỐNG CỨU HỘ: CHỐNG CRASH TRÊN IOS VÀ WEBVIEW (ZALO/FB/TIKTOK)
// =====================================================================
function attachCrashHandlers() {
    window.addEventListener('error', handleEngineCrash);
    window.addEventListener('unhandledrejection', handleEngineCrash);
}

function handleEngineCrash(e) {
    const msg = (e?.error?.message) || (e?.reason?.message) || String(e?.reason || "");
    if (msg.includes("Out of bounds memory access") || msg.includes("memory access out of bounds")) {
        fallbackToSingleThread(msg);
    }
}

function fallbackToSingleThread(reason) {
    // Nếu đã fallback rồi hoặc đang ở single rồi thì thôi
    if (fallbackTriggered || !currentWasmType || !currentWasmType.includes("multi")) return;
    
    fallbackTriggered = true;
    console.warn("🔥 Trình duyệt sập bộ nhớ do đa luồng. Kích hoạt Cứu Hộ (Fallback) về Đơn luồng!", reason);
    showToast("⚠️ Trình duyệt cạn RAM! Đang tự động chuyển về chế độ An toàn...");

    // 1. Tiêu diệt Engine đang chạy
    try {
        if (currentEngineInstance && typeof currentEngineInstance.terminate === 'function') {
            currentEngineInstance.terminate();
        }
    } catch (err) { console.warn("Lỗi khi kill engine", err); }

    currentEngineInstance = null;
    state.engineModule = null;

    // 2. Chuyển đổi định dạng (Từ multi -> single)
    let newType = "single";
    if (currentWasmType.includes("simd")) newType = "single_simd";

    // 3. Khởi động lại hệ thống
    setTimeout(() => {
        initPikafish(newType);
    }, 500);
}

// Dành cho nút Đi Ngay
export function triggerGoInstant() {
    if (!state.engineModule) return;
    pendingAction = 'go_instant';
    handleStateTransition(); // Sẽ tự động Kill Worker nếu cần
}

// Dành cho việc cưỡng chế dừng AI
export function forceStopEngine() {
    if (!state.engineModule || !isEngineSearching) return;
    pendingAction = null; // Hủy mọi lệnh chờ
    
    if (currentEngineInstance instanceof Worker) {
        currentEngineInstance.terminate();
        currentEngineInstance = null;
        state.engineModule = null;
        isEngineSearching = false;
        initPikafish(currentWasmType); // Hồi sinh để chờ lệnh mới
    } else {
        state.engineModule.sendCommand("stop");
        isEngineSearching = false;
    }
}

export async function startChartAnalysisProcess() {
    if (!state.rootNode || state.rootNode.children.length === 0) {
        import('./ui.js').then(ui => ui.showToast("Bàn cờ chưa có nước đi nào để phân tích!"));
        import('./events.js').then(ev => ev.exitChartMode());
        return;
    }
    
    import('./ui.js').then(ui => ui.showAILoading());

    state.isChartAnalyzed = false;
    import('./game.js').then(game => game.clearTreeAnalysisData(state.rootNode));

    let tempCountNode = state.rootNode;
    let totalNodes = 1; // Tính cả Node gốc (Start pos)
    while (tempCountNode.children.length > 0) {
        totalNodes++;
        tempCountNode = tempCountNode.children[tempCountNode.mainLineIndex];
    }
    state.chartTotalMoves = totalNodes;

    initChartUI(); // Reset Canvas

    if (state.engineModule) {
        state.engineModule.sendCommand("stop");
        state.engineModule.sendCommand(`setoption name Skill Level value 20`);
        state.engineModule.sendCommand(`setoption name MultiPV value 1`);
    }

    // Bắt đầu vẽ luôn
    if (state.rootNode) {
        chartCurrentNode = state.rootNode; 
        instantJumpToNode(chartCurrentNode, true);
    }
    
    setTimeout(() => {
        chartLatestCP = null;
        chartLatestMate = null;
        if (chartCurrentNode) analyzeNextChartNode();
    }, 100);
}

function analyzeNextChartNode() {
    if (chartTimerId) {
        clearTimeout(chartTimerId);
        chartTimerId = null;
    }

    instantJumpToNode(chartCurrentNode, true);

    chartLatestCP = null;
    chartLatestMate = null;
    chartNodeStartTime = Date.now();
    
    const maxTimeMs = state.chartSettings.runTime * 1000;
    const maxDepth = state.chartSettings.runDepth;

    state.engineModule.sendCommand(`position fen ${chartCurrentNode.fen}`);
    
    setTimeout(() => {
        if (!state.isChartDrawing) return; 

        state.engineModule.sendCommand(`go depth ${maxDepth}`); 
        isEngineSearching = true;

        chartTimerId = setTimeout(() => {
            if (isEngineSearching && state.isChartDrawing) {
                state.engineModule.sendCommand("stop");
            }
        }, maxTimeMs);

    }, 50); 
}

export function hardResetEngine() {
    console.log("🔥 Đang Hard Reset Engine & Xả RAM...");
    isEngineSearching = false;
    
    if (chartTimerId) {
        clearTimeout(chartTimerId);
        chartTimerId = null;
    }

    if (currentEngineInstance instanceof Worker) {
        currentEngineInstance.terminate();
    } else if (state.engineModule && typeof state.engineModule.sendCommand === 'function') {
        state.engineModule.sendCommand("stop"); 
    }
    
    currentEngineInstance = null;
    state.engineModule = null;

    setTimeout(() => {
        initPikafish();
    }, 300);
}

export function restoreEngineAfterChart() {
    console.log("Khôi phục cài đặt Engine sau khi tắt Biểu đồ...");
    
    if (state.engineModule) {
        state.engineModule.sendCommand("stop");
        state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
        state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);
    }

    isEngineSearching = false;

    if (state.isAnalyzing) {
        triggerEngineEvaluation();
    } else {
        pendingAction = null;
    }
}