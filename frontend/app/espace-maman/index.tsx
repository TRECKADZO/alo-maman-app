/**
 * Mon espace & mes droits — hub RGPD de la maman :
 * accès, rectification, limitation, résumé partageable, journal, consentements.
 */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "../../lib/api";
import EspaceHeader from "../../components/EspaceHeader";
import { COLORS, RADIUS, SPACING, SHADOW } from "../../constants/theme";

export default function EspaceMamanHub() {
  const router = useRouter();
  const [st, setSt] = useState<any>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [r, c, a, s, k] = await Promise.allSettled([
      api.get("/espace-maman/restrictions"),
      api.get("/espace-maman/corrections"),
      api.get("/audit-log/me?limit=200"),
      api.get("/espace-maman/resume/partages"),
      api.get("/consents/me"),
    ]);
    const val = (x: any) => (x.status === "fulfilled" ? x.value.data : null);
    const weekAgo = Date.now() - 7 * 86400000;
    const events = val(a)?.events || [];
    setSt({
      restr: val(r),
      pendingCorr: (val(c) || []).filter((x: any) => x.status === "en_attente").length,
      proAccess7d: events.filter((e: any) => e.user_role !== "maman" && e.action === "read" && new Date(e.timestamp).getTime() > weekAgo).length,
      activeShares: (val(s) || []).filter((x: any) => x.actif).length,
      activeConsents: (val(k)?.consents || []).filter((x: any) => x.status === "active").length,
    });
    setRefreshing(false);
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const restr = st.restr;
  const restrLabel = restr?.block_all
    ? "Tous les pros bloqués"
    : restr?.hidden_categories?.length
    ? `${restr.hidden_categories.length} rubrique(s) masquée(s)`
    : "Aucune restriction";

  const sections = [
    {
      title: "Mes droits sur mes données",
      items: [
        { id: "acces", icon: "eye", color: "#3B82F6", label: "Accéder à mes données", sub: "Voir ce qui est enregistré et tout télécharger", path: "/espace-maman/mes-donnees" },
        { id: "correction", icon: "create", color: "#F59E0B", label: "Corriger une information", sub: st.pendingCorr ? `${st.pendingCorr} demande(s) en attente` : "Demander une correction au professionnel", path: "/espace-maman/corrections", badge: st.pendingCorr },
        { id: "restriction", icon: "hand-left", color: restr?.block_all ? COLORS.error : "#10B981", label: "Restreindre l'accès", sub: restrLabel, path: "/espace-maman/restrictions" },
      ],
    },
    {
      title: "Partager mon parcours",
      items: [
        { id: "resume", icon: "document-text", color: "#C85A40", label: "Résumé de parcours", sub: st.activeShares ? `${st.activeShares} lien(s) actif(s)` : "PDF + lien sécurisé qui expire", path: "/espace-maman/resume" },
      ],
    },
    {
      title: "Transparence & contrôle",
      items: [
        { id: "journal", icon: "search", color: "#6366F1", label: "Journal d'accès", sub: `${st.proAccess7d ?? 0} consultation(s) par des tiers cette semaine`, path: "/audit-log" },
        { id: "consents", icon: "lock-closed", color: "#14B8A6", label: "Consentements", sub: `${st.activeConsents ?? 0} autorisation(s) active(s)`, path: "/consentements" },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <EspaceHeader title="Mon espace & mes droits" sub="Vous décidez qui voit quoi, et quand" />
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View style={[styles.status, restr?.block_all && { borderColor: COLORS.error, backgroundColor: "#FEF2F2" }]} testID="espace-status">
          <Ionicons name={restr?.block_all ? "lock-closed" : "shield-checkmark"} size={26} color={restr?.block_all ? COLORS.error : COLORS.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{restr?.block_all ? "Votre dossier est verrouillé" : "Votre dossier est protégé"}</Text>
            <Text style={styles.statusSub}>
              {restr?.block_all
                ? "Aucun professionnel ne peut le consulter, sauf urgence médicale (vous serez prévenue)."
                : "Chiffré, partagé uniquement avec vos professionnels. Chaque consultation vous est signalée."}
            </Text>
          </View>
        </View>

        {sections.map((s) => (
          <View key={s.title} style={{ marginTop: 18 }}>
            <Text style={styles.h2}>{s.title}</Text>
            {s.items.map((it: any) => (
              <TouchableOpacity key={it.id} style={styles.row} onPress={() => router.push(it.path)} testID={`espace-${it.id}`}>
                <View style={[styles.icon, { backgroundColor: `${it.color}1F` }]}>
                  <Ionicons name={it.icon} size={22} color={it.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{it.label}</Text>
                  <Text style={styles.rowSub}>{it.sub}</Text>
                </View>
                {it.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{it.badge}</Text></View> : null}
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  status: { flexDirection: "row", gap: 12, alignItems: "center", padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: "#BBF7D0", backgroundColor: "#F0FDF4" },
  statusTitle: { fontSize: 15, fontWeight: "800", color: COLORS.textPrimary },
  statusSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, lineHeight: 16 },
  h2: { fontSize: 13, fontWeight: "800", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 64, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8, ...SHADOW },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  rowSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.warning, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
});
