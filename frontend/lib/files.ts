/**
 * Helpers transverses : confirmation multiplateforme et enregistrement/partage de fichiers.
 */
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

export function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if ((window as any).confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Annuler", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}

/** Télécharge un fichier protégé de l'API puis ouvre la feuille de partage (ou téléchargement web). */
export async function downloadAndShare(apiPath: string, fileName: string, mimeType: string) {
  const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api${apiPath}`;
  const token = await AsyncStorage.getItem("auth_token");
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  if (Platform.OS === "web") {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    return;
  }
  const dest = `${FileSystem.cacheDirectory}${fileName}`;
  const r = await FileSystem.downloadAsync(url, dest, { headers });
  if (r.status !== 200) throw new Error(`Erreur ${r.status}`);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(r.uri, { mimeType, dialogTitle: fileName });
}
