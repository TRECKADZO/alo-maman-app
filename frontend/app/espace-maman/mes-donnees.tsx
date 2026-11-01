/**
 * Droit d'accès : inventaire des données détenues, profil santé modifiable, export complet.
 */
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, formatError } from "../../lib/api";
import { downloadAndShare } from "../../lib/files";
import EspaceHeader from "../../components/EspaceHeader";
import { COLORS, RADIUS, SPACING } from "../../constants/theme";

const GROUPES = ["A", "B", "AB", "O"];
const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function MesDonnees() {
  const [inv, setInv] = useState<any>(null);
  const [profil, setProfil] = useState<any>(null);
  const [form, setForm] = useState({ allergies: "", antecedents: "", traitements: "" });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [i, p] = await Promise.all([api.get("/espace-maman/mes-donnees"), api.get("/espace-maman/profil-sante")]);
        setInv(i.data);
        setProfil(p.data);
        setForm({ allergies: p.data.allergies.join(", "), antecedents: p.data.antecedents.join(", "), traitements: p.data.traitements.join(", ") });
      } catch (e) { Alert.alert("Erreur", formatError(e)); }
    })();
  }, []);

  const saveProfil = async () => {
    setSaving(true);
    try {
      const r = await api.put("/espace-maman/profil-sante", {
        groupe_sanguin: profil.groupe_sanguin || null,
        rhesus: profil.rhesus || null,
        allergies: toList(form.allergies),
        antecedents: toList(form.antecedents),
        traitements: toList(form.traitements),
      });
      setProfil(r.data);
      Alert.alert("✅ Enregistré", "Vos informations de santé sont à jour.");
    } catch (e) { Alert.alert("Erreur", formatError(e)); } finally { setSaving(false); }
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      await downloadAndShare("/espace-maman/export", `mes-donnees-alomaman-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    } catch (e) { Alert.alert("Erreur", formatError(e)); } finally { setExporting(false); }
  };

  if (!inv || !profil) return <SafeAreaView style={styles.center}><ActivityIndicator color={COLORS.primary} size="large" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <EspaceHeader title="Mes données" sub="Droit d'accès et de rectification" colors={["#3B82F6", "#6366F1"]} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.h2}>Ce que nous conservons</Text>
          <View style={styles.grid}>
            {inv.inventaire.map((i: any) => (
              <View key={i.key} style={styles.invItem} testID={`inv-${i.key}`}>
                <Text style={styles.invCount}>{i.count}</Text>
                <Text style={styles.invLabel}>{i.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Pourquoi ?</Text>
            {inv.finalites.map((f: string) => <Text key={f} style={styles.infoText}>• {f}</Text>)}
            <Text style={[styles.infoText, { marginTop: 6 }]}>{inv.conservation}</Text>
          </View>

          <TouchableOpacity style={styles.exportBtn} onPress={exportAll} disabled={exporting} testID="export-btn">
            {exporting ? <ActivityIndicator color="#fff" /> : <Ionicons name="download" size={18} color="#fff" />}
            <Text style={styles.exportText}>Télécharger toutes mes données</Text>
          </TouchableOpacity>

          <Text style={[styles.h2, { marginTop: 26 }]}>Mes informations de santé</Text>
          <Text style={styles.help}>Vous pouvez corriger vous-même ces informations. Elles figurent dans votre résumé de parcours.</Text>
          <Text style={styles.label}>Groupe sanguin</Text>
          <View style={styles.chips}>
            {GROUPES.map((g) => (
              <TouchableOpacity key={g} onPress={() => setProfil({ ...profil, groupe_sanguin: profil.groupe_sanguin === g ? null : g })}
                style={[styles.chip, profil.groupe_sanguin === g && styles.chipOn]} testID={`gs-${g}`}>
                <Text style={[styles.chipText, profil.groupe_sanguin === g && { color: "#fff" }]}>{g}</Text>
              </TouchableOpacity>
            ))}
            {["+", "-"].map((r) => (
              <TouchableOpacity key={r} onPress={() => setProfil({ ...profil, rhesus: profil.rhesus === r ? null : r })}
                style={[styles.chip, profil.rhesus === r && styles.chipOn]} testID={`rh-${r === "+" ? "pos" : "neg"}`}>
                <Text style={[styles.chipText, profil.rhesus === r && { color: "#fff" }]}>Rh {r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {([
            ["allergies", "Allergies", "Ex : pénicilline, arachide"],
            ["antecedents", "Antécédents", "Ex : césarienne 2022, hypertension"],
            ["traitements", "Traitements en cours", "Ex : fer, acide folique"],
          ] as const).map(([k, label, ph]) => (
            <View key={k}>
              <Text style={styles.label}>{label} <Text style={styles.labelHint}>(séparés par des virgules)</Text></Text>
              <TextInput value={form[k]} onChangeText={(v) => setForm({ ...form, [k]: v })} placeholder={ph}
                placeholderTextColor={COLORS.textMuted} style={styles.input} testID={`input-${k}`} />
            </View>
          ))}
          <TouchableOpacity style={styles.saveBtn} onPress={saveProfil} disabled={saving} testID="save-profil-sante">
            {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark-circle" size={18} color="#fff" />}
            <Text style={styles.exportText}>Enregistrer</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bgPrimary },
  h2: { fontSize: 15, fontWeight: "800", color: COLORS.textPrimary, marginBottom: 10 },
  help: { fontSize: 12, color: COLORS.textSecondary, marginTop: -4, marginBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  invItem: { width: "31.5%", padding: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border },
  invCount: { fontSize: 20, fontWeight: "900", color: "#3B82F6" },
  invLabel: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  infoBox: { marginTop: 12, padding: 12, backgroundColor: COLORS.secondaryLight, borderRadius: RADIUS.md },
  infoTitle: { fontSize: 13, fontWeight: "800", color: COLORS.textPrimary, marginBottom: 4 },
  infoText: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 17 },
  exportBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 14, minHeight: 48, borderRadius: 999, backgroundColor: "#3B82F6" },
  saveBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 18, minHeight: 48, borderRadius: 999, backgroundColor: COLORS.primary },
  exportText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  label: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary, marginTop: 12, marginBottom: 6 },
  labelHint: { fontSize: 11, fontWeight: "400", color: COLORS.textMuted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minWidth: 48, minHeight: 44, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 13, fontWeight: "800", color: COLORS.textPrimary },
  input: { minHeight: 48, paddingHorizontal: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, color: COLORS.textPrimary, fontSize: 14 },
});
