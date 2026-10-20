// Theme vor dem ersten Rendern setzen (verhindert Aufblitzen)
try { var t = localStorage.getItem('pp.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* egal */ }
