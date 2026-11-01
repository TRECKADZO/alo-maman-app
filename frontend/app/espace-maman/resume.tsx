/**
 * Résumé de parcours : aperçu, PDF, liens de partage expirants et révocables.
 */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Share, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api, formatError } from "../../lib/api";
import { confirmAction, downloadAndShare } from "../../lib/files";
import EspaceHeader from "../../components/EspaceHeader";
import { COLORS, RADIUS, SPACING } from "../../constants/theme";

const DUREES = [{ h: 24, l: "24 h" }, { h: 72, l: "3 jours" }, { h: 168, l: "7 jours" }];
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function Resume() {
  const router = useRouter();
  const [r, setR] = useState<any>(null);
  const [shares, setShares] = useState<any[]>([]);
  const [duree, setDuree] = useState(72);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const [a, b] = await Promise.all([api.get("/espace-maman/resume"), api.get("/espace-maman/resume/partages")]);
      setR(a.data);
      setShares(b.data);
    } catch (e) { Alert.alert("Erreur", formatError(e)); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const pdf = async () => {
    setBusy("pdf");
    try { await downloadAndShare("/espace-maman/resume/pdf", "resume-parcours.pdf", "application/pdf"); }
    catch (e) { Alert.alert("Erreur", formatError(e)); } finally { setBusy(null); }
  };

  const share = async () => {
    setBusy("share");
    try {
      const { data } = await api.post("/espace-maman/resume/partages", { duree_heures: duree });
      const url = `${BASE}${data.path}`;
      const until = new Date(data.expires_at).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      const message = `Mon résumé de parcours de santé (À lo Maman), valable jusqu'au ${until} :\n${url}`;
      if (Platform.OS === "web") {
        await Clipboard.setStringAsync(url);
        Alert.alert("🔗 Lien copié", message);
      } else {
        await Share.share({ message });
      }
      load();
    } catch (e) { Alert.alert("Erreur", formatError(e)); } finally { setBusy(null); }
  };

  const revoke = (s: any) => confirmAction("Révoquer ce lien ?", "Plus personne ne pourra ouvrir votre résumé avec ce lien.", "Révoquer", async () => {
    try { await api.delete(`/espace-maman/resume/partages/${s.id}`); load(); } catch (e) { Alert.alert("Erreur", formatError(e)); }
  });

  if (!r) return <SafeAreaView style={styles.center}><ActivityIndicator color={COLORS.primary} size="large" /></SafeAreaView>;
  const ps = r.profil_sante;
  const vaccins = r.enfants.reduce((n: number, e: any) => n + e.vaccins.length, 0);
  const active = shares.filter((s) => s.actif);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <EspaceHeader title="Résumé de parcours" sub="Clair, à jour, partageable" />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
        <View style={styles.card} testID="resume-preview">
          <Text style={styles.name}>{r.maman.nom}</Text>
          <View style={styles.essentials}>
            <Pill icon="water" color="#DC2626" text={`Groupe ${ps.groupe_sanguin ? ps.groupe_sanguin + (ps.rhesus || "") : "non renseigné"}`} />
            <Pill icon="alert-circle" color="#B45309" text={ps.allergies.length ? `Allergies : ${ps.allergies.join(", ")}` : "Aucune allergie connue"} />
          </View>
          {ps.antecedents.length ? <Text style={styles.line}>📋 Antécédents : {ps.antecedents.join(", ")}</Text> : null}
          {!ps.groupe_sanguin && !ps.allergies.length ? (
            <TouchableOpacity onPress={() => router.push("/espace-maman/mes-donnees")} testID="completer-profil">
              <Text style={styles.link}>Compléter mes informations essentielles →</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.stats}>
            <Stat n={r.grossesses.length} l="Grossesses" />
            <Stat n={r.accouchements.length} l="Accouchements" />
            <Stat n={r.enfants.length} l="Enfants" />
            <Stat n={vaccins} l="Vaccins" />
            <Stat n={r.consultations.length} l="Consultations" />
            <Stat n={r.documents.length} l="Documents" />
          </View>
          {r.enfants.map((e: any) => (
            <Text key={e.nom + e.date_naissance} style={styles.line}>
              👶 {e.nom} · {e.vaccins.length} vaccin(s){e.derniere_mesure ? ` · ${e.derniere_mesure.poids_kg ?? "—"} kg / ${e.derniere_mesure.taille_cm ?? "—"} cm` : ""}
            </Text>
          ))}
          {r.consultations[0] ? <Text style={styles.line}>🩺 Dernière consultation : {r.consultations[0].date} · {r.consultations[0].pro || "—"}</Text> : null}
        </View>

        <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.textPrimary }]} onPress={pdf} disabled={!!busy} testID="resume-pdf">
          {busy === "pdf" ? <ActivityIndicator color="#fff" /> : <Ionicons name="document" size={18} color="#fff" />}
          <Text style={styles.btnText}>Télécharger le PDF</Text>
        </TouchableOpacity>

        <Text style={styles.h2}>Partager avec un lien sécurisé</Text>
        <Text style={styles.help}>Le lien s’ouvre dans n’importe quel navigateur, sans compte. Il expire automatiquement et vous êtes prévenue à chaque ouverture.</Text>
        <View style={styles.seg}>
          {DUREES.map((d) => (
            <TouchableOpacity key={d.h} style={[styles.segBtn, duree === d.h && styles.segOn]} onPress={() => setDuree(d.h)} testID={`duree-${d.h}`}>
              <Text style={[styles.segText, duree === d.h && { color: "#fff" }]}>{d.l}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.btn} onPress={share} disabled={!!busy} testID="resume-share">
          {busy === "share" ? <ActivityIndicator color="#fff" /> : <Ionicons name="share-social" size={18} color="#fff" />}
          <Text style={styles.btnText}>Créer et partager le lien</Text>
        </TouchableOpacity>

        <Text style={styles.h2}>Liens actifs ({active.length})</Text>
        {active.length === 0 ? <Text style={styles.help}>Aucun lien actif.</Text> : active.map((s) => (
          <View key={s.id} style={styles.shareRow} testID={`share-${s.id}`}>
            <Ionicons name="link" size={18} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.shareTitle}>Expire le {new Date(s.expires_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
              <Text style={styles.shareSub}>{s.views} ouverture(s){s.last_view_at ? ` · dernière le ${new Date(s.last_view_at).toLocaleDateString("fr-FR")}` : ""}</Text>
            </View>
            <TouchableOpacity onPress={() => revoke(s)} style={styles.revoke} testID={`revoke-${s.id}`}>
              <Text style={styles.revokeText}>Révoquer</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Pill({ icon, color, text }: { icon: any; color: string; text: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${color}14` }]}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.pillText, { color }]} numberOfLines={2}>{text}</Text>
    </View>
  );
}
function Stat({ n, l }: { n: number; l: string }) {
  return <View style={styles.stat}><Text style={styles.statN}>{n}</Text><Text style={styles.statL}>{l}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bgPrimary },
  card: { padding: 14, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  name: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  essentials: { gap: 6, marginTop: 10 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.sm },
  pillText: { flex: 1, fontSize: 12, fontWeight: "700" },
  line: { fontSize: 12, color: COLORS.textSecondary, marginTop: 6 },
  link: { fontSize: 13, color: COLORS.primary, fontWeight: "800", marginTop: 8 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12, marginBottom: 4 },
  stat: { width: "31.5%", paddingVertical: 8, alignItems: "center", backgroundColor: COLORS.bgSecondary, borderRadius: RADIUS.sm },
  statN: { fontSize: 18, fontWeight: "900", color: COLORS.primary },
  statL: { fontSize: 10, color: COLORS.textSecondary },
  btn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 12, minHeight: 50, borderRadius: 999, backgroundColor: COLORS.primary },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  h2: { fontSize: 15, fontWeight: "800", color: COLORS.textPrimary, marginTop: 24 },
  help: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, marginBottom: 10, lineHeight: 17 },
  seg: { flexDirection: "row", gap: 6 },
  segBtn: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  segOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segText: { fontSize: 13, fontWeight: "800", color: COLORS.textPrimary },
  shareRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  shareTitle: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary },
  shareSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  revoke: { paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: COLORS.error },
  revokeText: { color: COLORS.error, fontSize: 12, fontWeight: "800" },
});
