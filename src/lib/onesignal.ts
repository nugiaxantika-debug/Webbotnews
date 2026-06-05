import OneSignal from 'react-onesignal';

let isInitialized = false;

export const setupOneSignal = async () => {
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
  if (!appId) {
    console.warn("OneSignal App ID is missing.");
    return false;
  }
  
  try {
    if (!isInitialized) {
        await OneSignal.init({
            appId: appId,
            allowLocalhostAsSecureOrigin: true, // for dev testing
        });
        isInitialized = true;
        console.log("OneSignal initialized");
    }
    return true;
  } catch (err) {
    console.error("Error initializing OneSignal:", err);
    return false;
  }
};

export const requestOneSignalPermission = async () => {
    try {
        await OneSignal.Slidedown.promptPush();
        const hasPermission = OneSignal.Notifications.permission;
        return hasPermission;
    } catch (e) {
        console.error(e);
        return false;
    }
};
