// main.js

window.module = window.module || {};

// Import các Module chính
import { initGame } from './js/game.js';
import { initEvents } from './js/events.js';
import { preloadImages, initCanvas } from './js/board.js';

// Cài đặt Event Toàn cục
initEvents();

// Vòng đời ứng dụng (Khởi động chắc chắn dù trang tải nhanh hay chậm)
async function startApp() {
    try {
        await preloadImages();
        initCanvas();
        initGame(undefined, true);
        fetchAppVersion();

        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                window.dispatchEvent(new Event('resize'));
            });
            resizeObserver.observe(document.body);
        }
    } catch (e) {
        console.error("❌ App startup error:", e);
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}

// Đăng ký Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(() => { console.log("✅ PWA Ready"); })
        .catch(err => console.log("❌ PWA Error:", err));
    });
}

// Hàm đọc file sw.js để lấy biến CACHE_NAME
function fetchAppVersion() {
    const el = document.getElementById('app-version-text');
    if (!el) return;
    
    fetch('./sw.js')
        .then(response => response.text())
        .then(text => {
            // Tìm dòng chứa CACHE_NAME = '...'
            const match = text.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
            if (match && match[1]) {
                el.innerText = `Phiên bản: ${match[1]}`;
            } else {
                el.innerText = `Phiên bản: Không xác định`;
            }
        })
        .catch(err => {
            el.innerText = `Phiên bản: Lỗi đọc SW`;
        });
}