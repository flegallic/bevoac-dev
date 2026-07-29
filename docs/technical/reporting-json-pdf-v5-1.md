# Reporting JSON et PDF Bevoac V5.1

## 1. Objectif

Remplacer l'ancien `report_template.md`, qui melangeait etat implemente et cible produit, par une documentation du rapport reel genere par l'API V5.1.

## 2. Role du JSON

Le JSON API est la source exhaustive du scan.

Il doit rester disponible via:

```text
GET /v1/scans/:scanId
```

Il contient les donnees completes retournees par les modules executes, y compris les evidence detailles, les ressources affectees et les proprietes observees.

## 3. Role du PDF

Le PDF V5.1 est un rapport finding/remediation/evidence. Il sert a:

- fournir une synthese exploitable;
- prioriser les risques;
- afficher les controles executes;
- presenter les remediations;
- donner des exemples d'evidence;
- rendre la demonstration et le pilote lisibles.

Le PDF ne remplace pas le JSON exhaustif.

## 4. Analyse du PDF genere actuellement

Le PDF fourni `reports_full.pdf` ameliore fortement l'ancien point faible documentaire. Il contient:

- titre et date de generation;
- score global et decision de remediation;
- resume des risques principaux;
- contexte d'audit: scan ID, tenant Bevoac, cloud provider, scan profile, Microsoft tenant, subscriptions, ressources comptees;
- section `Report scope and evidence model` indiquant que le PDF est finding-oriented et que le JSON API reste complet;
- distribution des severites;
- distribution des statuts;
- resume par module;
- top risks;
- remediation priorities avec SLA recommande;
- control matrix;
- technical evidence appendix;
- methodology and interpretation.

Conclusion:

```text
Le rapport PDF actuel est suffisamment credible pour une demonstration et un pilote B2B cadre, sous reserve de bien expliquer que le JSON reste la source exhaustive et que le score n'est pas une certification.
```

## 5. Sections PDF V5.1 a documenter

| Section | Role |
|---|---|
| Audit context | Identifie le scan, le tenant, le provider, le profil et le perimetre |
| Report scope and evidence model | Explique que le PDF est borne et finding-oriented |
| Executive Summary | Donne la posture globale |
| Severity distribution | Repartition CRITICAL/HIGH/MEDIUM/LOW/INFO/UNKNOWN |
| Status distribution | Repartition FAILED/WARNING/PASSED/INFO/UNKNOWN |
| Module summary | Vue par module, execution et posture |
| Top risks | Risques prioritaires |
| Remediation priorities | Actions recommandees et SLA indicatif |
| Control Matrix | Liste des controles et statuts |
| Technical Evidence Appendix | Evidence et ressources affectees, avec echantillons bornes |
| Methodology | Interpretation du score, status et posture |

## 6. Limites a conserver dans la documentation

Le PDF doit etre documente avec ces limites:

- il ne liste pas forcement toutes les ressources decouvertes;
- les ressources affectees peuvent etre echantillonnees;
- l'evidence PDF est plafonnee pour rester lisible;
- le score global est un indicateur d'aide a la decision;
- le PDF ne constitue pas une certification ISO ou une acceptation de risque;
- le JSON API est la source exhaustive.

## 7. Formulations interdites

Ne pas ecrire:

- `rapport ISO 27001 complet`;
- `certificat de conformite`;
- `preuve de conformite formelle`;
- `score contractuel`;
- `exhaustivite PDF garantie`.

## 8. Formulation recommandee

> Le PDF Bevoac V5.1 est un rapport d'audit finding/remediation/evidence. Il synthetise les controles executes, les ecarts detectes, les ressources affectees, les proprietes techniques observees et les actions de remediation. Pour les volumes eleves, le PDF presente un echantillon borne d'evidence; le JSON API reste la source exhaustive.

## 9. Roadmap reporting

A documenter comme evolution, pas comme livre:

- profils PDF `executive`, `technical`, `full-evidence`;
- redaction PII / executive safe mode;
- mapping ISO/NIST/CIS plus detaille;
- export passed evaluations dedie auditeur;
- annexe exhaustive separee ou export objet;
- signature/hash/verifiable report package.
