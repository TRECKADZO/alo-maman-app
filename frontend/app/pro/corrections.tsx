/**
 * Pro — demandes de correction reçues des patientes (droit de rectification).
 */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, formatError } from "../../lib/api";
import EspaceHeader from "../../components/EspaceHeader";
import { COLORS, RADIUS, SPACING } from "../../constants/theme";

export default function ProCorrections() {
  const [items, setItems] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const [rep, setRep] = useState({ reponse: "", nouvelle_valeur: "" });
  const [sending, setSending] = useState(false);

  const load = async () => {
    try { setItems((await api.get("/pro/corrections")).data); } catch (e) { Alert.alert("Erreur", formatError(e)); setItems([]); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const open = (c: any) => { setSel(c); setRep({ reponse: "", nouvelle_valeur: c.correction_demandee }); };

  const answer = async (accepte: boolean) => {
    if (rep.reponse.trim().length < 3) return Alert.alert("Réponse requise", "Expliquez votre décision à la patiente.");
    setSending(true);
    try {
      await api.post(`/pro/corrections/${sel.id}/repondre`, { accepte, reponse: rep.reponse, nouvelle_valeur: accepte ? rep.nouvelle_valeur : null });
      setSel(null);
      load();
    } catch (e) { Alert.alert("Erreur", formatError(e)); } finally { setSending(false); }
  };

  const pending = (items || []).filter((c) => c.status === "en_attente");
  const done = (items || []).filter((c) => c.status !== "en_attente");

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <EspaceHeader title="Demandes de correction" sub={`${pending.length} en attente`} colors={["#F59E0B", "#C85A40"]} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}>
        {items === null ? <ActivityIndicator color={COLORS.primary} /> : items.length === 0 ? (
          <Text style={styles.empty}>Aucune demande reçue.</Text>
        ) : (
          <>
            {pending.map((c) => (
              <TouchableOpacity key={c.id} style={[styles.card, { borderColor: COLORS.warning }]} onPress={() => open(c)} testID={`pro-corr-${c.id}`}>
                <Text style={styles.who}>{c.maman_name} · {new Date(c.created_at).toLocaleDateString("fr-FR")}</Text>
                {c.champ ? <Text style={styles.meta}>Note médicale · {c.champ}</Text> : <Text style={styles.meta}>Autre information</Text>}
                <Text style={styles.ask}>« {c.correction_demandee} »</Text>
                <Text style={styles.cta}>Répondre →</Text>
              </TouchableOpacity>
            ))}
            {done.length ? <Text style={styles.h2}>Traitées</Text> : null}
            {done.map((c) => (
              <View key={c.id} style={styles.card}>
                <Text style={styles.who}>{c.maman_name} · {c.status === "acceptee" ? "✅ Acceptée" : "❌ Refusée"}</Text>
                <Text style={styles.ask}>« {c.correction_demandee} »</Text>
                <Text style={styles.meta}>Votre réponse : {c.pro_reponse}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
            {sel && (
              <View style={styles.modalCard}>
                <View style={styles.modalHead}>
                  <Text style={styles.modalTitle}>Demande de {sel.maman_name}</Text>
                  <TouchableOpacity onPress={() => setSel(null)} hitSlop={10}><Ionicons name="close" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
                </View>
                {sel.valeur_actuelle ? <Text style={styles.meta}>Valeur actuelle ({sel.champ}) : {sel.valeur_actuelle}</Text> : null}
                <Text style={styles.ask}>Demandé : {sel.correction_demandee}</Text>
                {sel.motif ? <Text style={styles.meta}>Motif : {sel.motif}</Text> : null}
                {sel.target_type === "consultation_note" && (
                  <>
                    <Text style={styles.label}>Nouvelle valeur (si acceptée)</Text>
                    <TextInput style={[styles.input, { minHeight: 70 }]} multiline value={rep.nouvelle_valeur} onChangeText={(v) => setRep({ ...rep, nouvelle_valeur: v })} testID="pro-corr-value" />
                  </>
                )}
                <Text style={styles.label}>Votre réponse à la patiente *</Text>
                <TextInput style={[styles.input, { minHeight: 70 }]} multiline value={rep.reponse} onChangeText={(v) => setRep({ ...rep, reponse: v })}
                  placeholder="Expliquez votre décision" placeholderTextColor={COLORS.textMuted} testID="pro-corr-reponse" />
                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.error }]} onPress={() => answer(false)} disabled={sending} testID="pro-corr-refuser">
                    <Text style={styles.btnText}>Refuser</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.success }]} onPress={() => answer(true)} disabled={sending} testID="pro-corr-accepter">
                    {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Accepter</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  empty: { textAlign: "center", color: COLORS.textMuted, marginTop: 30 },
  h2: { fontSize: 13, fontWeight: "800", color: COLORS.textMuted, marginTop: 16, marginBottom: 8, textTransform: "uppercase" },
  card: { padding: 12, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  who: { fontSize: 13, fontWeight: "800", color: COLORS.textPrimary },
  meta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  ask: { fontSize: 13, color: COLORS.textPrimary, marginTop: 6 },
  cta: { fontSize: 12, fontWeight: "800", color: COLORS.primary, marginTop: 8 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  modalCard: { backgroundColor: COLORS.bgPrimary, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: SPACING.xl, paddingBottom: 40 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 17, fontWeight: "800", color: COLORS.textPrimary, flex: 1 },
  label: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary, marginTop: 14, marginBottom: 6 },
  input: { padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, color: COLORS.textPrimary, fontSize: 14, textAlignVertical: "top" },
  btn: { flex: 1, minHeight: 50, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
