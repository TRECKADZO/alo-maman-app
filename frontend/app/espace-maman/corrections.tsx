/**
 * Droit de rectification : la maman demande au pro auteur de corriger une information.
 */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, formatError } from "../../lib/api";
import EspaceHeader from "../../components/EspaceHeader";
import { COLORS, RADIUS, SPACING } from "../../constants/theme";

const STATUS: Record<string, { label: string; color: string; icon: any }> = {
  en_attente: { label: "En attente", color: COLORS.warning, icon: "time" },
  acceptee: { label: "Acceptée", color: COLORS.success, icon: "checkmark-circle" },
  refusee: { label: "Refusée", color: COLORS.error, icon: "close-circle" },
};
const CHAMPS = [["diagnostic", "Diagnostic"], ["traitement", "Traitement"], ["notes", "Notes"]] as const;

export default function Corrections() {
  const [items, setItems] = useState<any[] | null>(null);
  const [cibles, setCibles] = useState<any>({ notes: [], pros: [] });
  const [modal, setModal] = useState(false);
  const [f, setF] = useState<any>({ target_type: "consultation_note", target_id: null, champ: "diagnostic", pro_id: null, correction_demandee: "", motif: "" });
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      const [a, b] = await Promise.all([api.get("/espace-maman/corrections"), api.get("/espace-maman/corrections/cibles")]);
      setItems(a.data);
      setCibles(b.data);
    } catch (e) { Alert.alert("Erreur", formatError(e)); setItems([]); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const openNew = () => {
    setF({ target_type: cibles.notes.length ? "consultation_note" : "autre", target_id: cibles.notes[0]?.id || null, champ: "diagnostic", pro_id: cibles.pros[0]?.id || null, correction_demandee: "", motif: "" });
    setModal(true);
  };

  const send = async () => {
    if (f.correction_demandee.trim().length < 3) return Alert.alert("Précisez la correction souhaitée");
    if (f.target_type === "consultation_note" && !f.target_id) return Alert.alert("Choisissez une note");
    if (f.target_type === "autre" && !f.pro_id) return Alert.alert("Choisissez un professionnel");
    setSending(true);
    try {
      const body = f.target_type === "autre" ? { ...f, champ: null, target_id: null } : f;
      await api.post("/espace-maman/corrections", body);
      setModal(false);
      Alert.alert("✅ Demande envoyée", "Le professionnel va examiner votre demande. Vous serez notifiée de sa réponse.");
      load();
    } catch (e) { Alert.alert("Erreur", formatError(e)); } finally { setSending(false); }
  };

  const selNote = cibles.notes.find((n: any) => n.id === f.target_id);
  const canCreate = cibles.notes.length > 0 || cibles.pros.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <EspaceHeader title="Corriger une information" sub="Droit de rectification" colors={["#F59E0B", "#C85A40"]} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}>
        <View style={styles.info}>
          <Ionicons name="information-circle" size={18} color="#B45309" />
          <Text style={styles.infoText}>
            Une information médicale écrite par un professionnel ne peut être modifiée que par lui. Envoyez-lui une demande : il l’accepte (la correction est appliquée) ou la refuse en expliquant pourquoi. Vos propres informations (allergies, groupe sanguin…) se corrigent dans « Mes données ».
          </Text>
        </View>
        {items === null ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 30 }} /> : items.length === 0 ? (
          <Text style={styles.empty}>Aucune demande de correction pour le moment.</Text>
        ) : items.map((c) => {
          const s = STATUS[c.status] || STATUS.en_attente;
          return (
            <View key={c.id} style={styles.card} testID={`corr-${c.id}`}>
              <View style={styles.cardTop}>
                <Ionicons name={s.icon} size={18} color={s.color} />
                <Text style={[styles.status, { color: s.color }]}>{s.label}</Text>
                <Text style={styles.date}>{new Date(c.created_at).toLocaleDateString("fr-FR")}</Text>
              </View>
              <Text style={styles.pro}>À : {c.pro_name || "Professionnel"}{c.champ ? ` · ${c.champ}` : ""}</Text>
              {c.valeur_actuelle ? <Text style={styles.old}>Actuel : {c.valeur_actuelle}</Text> : null}
              <Text style={styles.ask}>Demandé : {c.correction_demandee}</Text>
              {c.pro_reponse ? <Text style={styles.reply}>💬 Réponse : {c.pro_reponse}</Text> : null}
            </View>
          );
        })}
      </ScrollView>

      {canCreate && (
        <TouchableOpacity style={styles.fab} onPress={openNew} testID="new-correction">
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.fabText}>Nouvelle demande</Text>
        </TouchableOpacity>
      )}

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
            <View style={styles.modalCard}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>✏️ Demande de correction</Text>
                <TouchableOpacity onPress={() => setModal(false)} hitSlop={10} testID="corr-close"><Ionicons name="close" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
              </View>
              <View style={styles.seg}>
                {[["consultation_note", "Une note médicale"], ["autre", "Autre information"]].map(([k, l]) => (
                  <TouchableOpacity key={k} style={[styles.segBtn, f.target_type === k && styles.segOn]} onPress={() => setF({ ...f, target_type: k })}
                    disabled={k === "consultation_note" && !cibles.notes.length} testID={`type-${k}`}>
                    <Text style={[styles.segText, f.target_type === k && { color: "#fff" }]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {f.target_type === "consultation_note" ? (
                <>
                  <Text style={styles.label}>Note concernée</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {cibles.notes.map((n: any) => (
                      <TouchableOpacity key={n.id} onPress={() => setF({ ...f, target_id: n.id })} testID={`corr-note-${n.id}`} style={[styles.pick, f.target_id === n.id && styles.pickOn]}>
                        <Text style={styles.pickTitle}>{String(n.date).slice(0, 10)}</Text>
                        <Text style={styles.pickSub} numberOfLines={1}>{n.pro_name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={styles.label}>Champ à corriger</Text>
                  <View style={styles.seg}>
                    {CHAMPS.map(([k, l]) => (
                      <TouchableOpacity key={k} style={[styles.segBtn, f.champ === k && styles.segOn]} onPress={() => setF({ ...f, champ: k })} testID={`champ-${k}`}>
                        <Text style={[styles.segText, f.champ === k && { color: "#fff" }]}>{l}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {selNote ? <Text style={styles.old}>Actuel : {selNote[f.champ] || "—"}</Text> : null}
                </>
              ) : (
                <>
                  <Text style={styles.label}>Professionnel concerné</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {cibles.pros.map((p: any) => (
                      <TouchableOpacity key={p.id} onPress={() => setF({ ...f, pro_id: p.id })} testID={`corr-pro-${p.id}`} style={[styles.pick, f.pro_id === p.id && styles.pickOn]}>
                        <Text style={styles.pickTitle} numberOfLines={1}>{p.name}</Text>
                        <Text style={styles.pickSub} numberOfLines={1}>{p.specialite || "Professionnel"}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              <Text style={styles.label}>Correction souhaitée *</Text>
              <TextInput style={[styles.input, { minHeight: 80 }]} multiline value={f.correction_demandee} onChangeText={(v) => setF({ ...f, correction_demandee: v })}
                placeholder="Écrivez la bonne information" placeholderTextColor={COLORS.textMuted} testID="corr-text" />
              <Text style={styles.label}>Pourquoi ? (optionnel)</Text>
              <TextInput style={styles.input} value={f.motif} onChangeText={(v) => setF({ ...f, motif: v })}
                placeholder="Ex : erreur de date, mauvais traitement noté" placeholderTextColor={COLORS.textMuted} testID="corr-motif" />
              <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={sending} testID="corr-send">
                {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={16} color="#fff" />}
                <Text style={styles.fabText}>Envoyer la demande</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  info: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: "#FFFBEB", borderRadius: RADIUS.md, borderWidth: 1, borderColor: "#FDE68A", marginBottom: 14 },
  infoText: { flex: 1, fontSize: 12, color: "#92400E", lineHeight: 17 },
  empty: { textAlign: "center", color: COLORS.textMuted, marginTop: 30 },
  card: { padding: 12, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { flex: 1, fontSize: 13, fontWeight: "800" },
  date: { fontSize: 11, color: COLORS.textMuted },
  pro: { fontSize: 12, fontWeight: "700", color: COLORS.textPrimary, marginTop: 6 },
  old: { fontSize: 12, color: COLORS.textMuted, marginTop: 4, textDecorationLine: "line-through" },
  ask: { fontSize: 13, color: COLORS.textPrimary, marginTop: 4 },
  reply: { fontSize: 12, color: COLORS.textSecondary, marginTop: 6, fontStyle: "italic" },
  fab: { position: "absolute", bottom: 28, alignSelf: "center", flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 22, minHeight: 50, borderRadius: 999, backgroundColor: COLORS.primary },
  fabText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  modalCard: { backgroundColor: COLORS.bgPrimary, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: SPACING.xl, paddingBottom: 40 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  seg: { flexDirection: "row", gap: 6 },
  segBtn: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  segOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segText: { fontSize: 12, fontWeight: "800", color: COLORS.textPrimary },
  label: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary, marginTop: 14, marginBottom: 6 },
  pick: { width: 140, padding: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  pickOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  pickTitle: { fontSize: 13, fontWeight: "800", color: COLORS.textPrimary },
  pickSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  input: { minHeight: 48, padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, color: COLORS.textPrimary, fontSize: 14, textAlignVertical: "top" },
  sendBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 18, minHeight: 50, borderRadius: 999, backgroundColor: COLORS.primary },
});
