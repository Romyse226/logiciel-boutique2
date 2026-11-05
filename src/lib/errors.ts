/**
 * Traduit une erreur technique (Postgres / réseau) en message compréhensible
 * pour l'utilisateur. Aucun message brut de base de données ne doit atteindre
 * l'interface.
 */
export function userMessage(e: unknown): string {
  // Les erreurs Supabase (`PostgrestError`) sont des objets simples, pas des
  // instances d'Error : sans lire explicitement `.message`, toute erreur
  // serveur devenait le message générique « L'action a échoué. Réessayez. ».
  const raw =
    typeof e === 'string'
      ? e
      : e instanceof Error
        ? e.message
        : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
          ? (e as { message: string }).message
          : '';
  if (!raw) return 'L’action a échoué. Réessayez.';

  if (/more target columns than expressions|syntax error|does not exist|violates .* constraint|invalid input|permission denied/i.test(raw)) {
    return 'Action impossible : les informations envoyées sont incomplètes. Réessayez.';
  }
  // Certaines fonctions serveur (ex. `register_sale`) renvoient leurs refus en
  // anglais : on les reconnaît aussi, sinon la cause réelle serait masquée par
  // le message générique « L'action a échoué. Réessayez. ».
  if (/Stock insuffisant|Insufficient stock/i.test(raw)) return 'Stock insuffisant pour ce produit.';
  if (/Prix incohérent|price mismatch|inconsistent price/i.test(raw)) return 'Le prix de ce produit a changé. Actualisez puis réessayez.';
  if (/Unité de vente introuvable|Produit introuvable|Sale unit not found|Product not found/i.test(raw)) return 'Les prix de ce produit ne sont pas configurés.';
  if (/Produit archivé|archived/i.test(raw)) return 'Ce produit n’est plus disponible.';
  if (/Aucun article|No items in sale/i.test(raw)) return 'Ajoutez au moins un article.';
  if (/Quantité|Invalid quantity|decimal quantity/i.test(raw)) return 'Quantité invalide.';
  if (/Montant|Invalid amount/i.test(raw)) return 'Montant invalide.';
  if (/déjà soldée|déjà annulée|already (sold|cancelled)/i.test(raw)) return raw;
  // Refus d'accès renvoyé par le contrôle d'accès serveur (`register_sale`) :
  // on le reformule en français au lieu d'afficher le texte brut du serveur.
  if (/accès a été retiré|access revoked|réactiv|reactivate/i.test(raw)) {
    return 'Votre accès a été retiré. Demande au patron de le réactiver.';
  }
  // Messages liés à l'identité de l'appareil : déjà rédigés pour l'utilisateur,
  // on les affiche tels quels (sinon la cause réelle serait masquée).
  if (/identité|identifié|gérant du commerce|Code patron|code du patron|code secret|code temporaire|patron (non )?configuré|Connexion au serveur impossible|Demande au boss/i.test(raw)) return raw;
  if (/Failed to fetch|NetworkError|network|Load failed|fetch/i.test(raw)) {
    return 'Connexion au serveur impossible. Vérifiez votre réseau.';
  }
  return 'L’action a échoué. Réessayez.';
}
