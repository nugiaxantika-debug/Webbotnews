importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const firebaseConfig = {
  projectId: "jadibotvip",
  appId: "1:108677295600:web:b6d680ba33479218bd0135",
  apiKey: "AIzaSyCyBfAPSumISwLzBtLCtl7TLspOLjBo9sE",
  authDomain: "jadibotvip.firebaseapp.com",
  messagingSenderId: "108677295600"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  if (payload.notification) {
    // If notification payload exists, Firebase will automatically display it.
    // We don't need to manually call showNotification here.
    return;
  }

  const notificationTitle = payload.data?.title || 'Notifikasi Baru';
  const notificationOptions = {
    body: payload.data?.body || '',
    icon: '/vite.svg',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
