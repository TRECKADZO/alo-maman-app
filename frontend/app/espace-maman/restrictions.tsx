/**
 * Droit à la limitation : blocage global des pros + masquage par rubrique.
 */
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, formatError } from "../../lib/api";
import { confirmAction } from "../../lib/files";
import EspaceHeader from "../../components/EspaceHeader";
import { COLORS, RADIUS, SPACING } from "../../constants/theme";

export default function Restrictions() {
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/espace-maman/restrictions").then((r) => setData(r.data)).catch((e) => Alert.alert("Erreur", formatError(e)));
  }, []);

  const save = async (next: { block_all: boolean; hidden_categories: string[] }) => {
    const prev = data;
    setData({ ...data, ...next });
    setSaving(true);
    try {
      const r = await api.put("/espace-maman/restrictions", next);
      setData(r.data);
    } catch (e) {
      setData(prev);
      Alert.alert("Erreur", formatError(e));
    } finally { setSaving(false); }
  };

  const toggleBlock = (v: boolean) => {
    if (!v) return save({ block_all: false, hidden_categories: data.hidden_categories });
    confirmAction(
      "Verrouiller votre dossier ?",
      "Plus aucun professionnel ne pourra consulter votre dossier ni celui de vos enfants. Seul un accès d'urgence motivé restera possible, et vous serez prévenue.",
      "Verrouiller",
      () => save({ block_all: true, hidden_categories: data.hidden_categories }),
    );
  };

  const toggleCat = (k: string) => {
    const hidden: string[] = data.hidden_categories || [];
    save({ block_all: data.block_all, hidden_categories: hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k] });
  };

  if (!data) return <SafeAreaView style={styles.center}><ActivityIndicator color={COLORS.primary} size="large" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <EspaceHeader title="Restreindre l'accès" sub={saving ? "Enregistrement…" : "Modifiable à tout moment"} colors={["#10B981", "#0EA5E9"]} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
        <View style={[styles.card, data.block_all && { borderColor: COLORS.error }]}>
          <View style={styles.rowTop}>
            <Ionicons name="lock-closed" size={22} color={data.block_all ? COLORS.error : COLORS.textSecondary} />
            <Text style={styles.cardTitle}>Bloquer tous les professionnels</Text>
            <Switch value={!!data.block_all} onValueChange={toggleBlock} trackColor={{ true: COLORS.error, false: COLORS.border }} testID="toggle-block-all" />
          </View>
          <Text style={styles.cardSub}>
            Suspend tout accès à votre dossier et à ceux de vos enfants, même avec un consentement ou un code de partage. En cas d’urgence vitale, un professionnel peut forcer l’accès en indiquant un motif : vous êtes alors prévenue immédiatement.
          </Text>
        </View>

        <Text style={styles.h2}>Masquer certaines rubriques</Text>
        <Text style={styles.help}>Les rubriques masquées n’apparaissent plus dans le dossier vu par les professionnels.</Text>
        {Object.entries(data.categories || {}).map(([k, label]: any) => {
          const on = (data.hidden_categories || []).includes(k);
          return (
            <TouchableOpacity key={k} style={[styles.catRow, on && styles.catRowOn]} onPress={() => toggleCat(k)} testID={`cat-${k}`}>
              <Ionicons name={on ? "eye-off" : "eye"} size={20} color={on ? COLORS.warning : COLORS.success} />
              <Text style={styles.catLabel}>{label}</Text>
              <Text style={[styles.catState, { color: on ? COLORS.warning : COLORS.success }]}>{on ? "Masquée" : "Visible"}</Text>
            </TouchableOpacity>
          );
        })}
        {data.updated_at ? <Text style={styles.updated}>Dernière modification : {new Date(data.updated_at).toLocaleString("fr-FR")}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bgPrimary },
  card: { padding: 14, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: COLORS.textPrimary },
  cardSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 8, lineHeight: 17 },
  h2: { fontSize: 15, fontWeight: "800", color: COLORS.textPrimary, marginTop: 22 },
  help: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, marginBottom: 10 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 14, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  catRowOn: { borderColor: COLORS.warning, backgroundColor: "#FFFBEB" },
  catLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  catState: { fontSize: 12, fontWeight: "800" },
  updated: { fontSize: 11, color: COLORS.textMuted, textAlign: "center", marginTop: 14, fontStyle: "italic" },
});
