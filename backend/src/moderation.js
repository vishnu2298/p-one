// Local safety net that works even when the Python insights service is down.
// Blocks clearly prohibited content under Indian law/platform policy (weapons, narcotics, wildlife, fake documents, organs, adult services).
const RULES = [
  ['weapons', /\b(pistol|revolver|rifle|ammunition|ammo|explosives?|grenade|country[- ]made (gun|pistol)|ak-?47|bullets?)\b/i],
  ['narcotics', /\b(ganja|cocaine|heroin|mdma|charas|opium|brown sugar|lsd)\b|\bweed(?!\s*(killer|cutter|trimmer|remover|whacker))\b/i],
  ['wildlife', /\b(ivory|tiger (skin|claws?)|pangolin|star tortoise|leopard skin|elephant tusk)\b/i],
  ['fake_documents', /\bfake (aadhaar|aadhar|pan|passport|licen[cs]e|marksheet|certificate|degree|id card)\b|\bduplicate (marksheet|certificate)\b/i],
  ['organs', /\b(kidney|liver|organ)s? (for sale|needed|donor wanted)\b|\bsell(ing)? (my )?kidney\b/i],
  ['adult_services', /\b(escort|call girl|adult massage|happy ending|sex service)\b/i],
];

function check(text) {
  const t = String(text || '');
  const flags = RULES.filter(([, rx]) => rx.test(t)).map(([f]) => f);
  return { allowed: flags.length === 0, flags, reason: flags.length ? 'This content is not allowed on Connectly (prohibited item or service). Please remove it and try again.' : null, source: 'local' };
}

module.exports = { check };
