const electron = require('electron');
console.log('typeof electron:', typeof electron);
console.log('typeof electron.app:', typeof electron.app);

if (electron.app) {
  electron.app.whenReady().then(() => {
    console.log('App ready!');
    electron.app.quit();
  });
} else {
  console.log('Keys:', Object.getOwnPropertyNames(electron).slice(0, 20));
  console.log('Proto keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(electron) || {}).slice(0, 20));
  process.exit(1);
}
