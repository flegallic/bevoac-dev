# Positionnement marche source Bevoac V5.1

## 1. Objectif

Document interne. Ce fichier ne sert pas encore de documentation client finale. Il sert a formuler un positionnement prudent, source et defendable.

## 2. Regle de redaction

Ne pas affirmer que Bevoac remplace Wiz, Orca ou Microsoft Defender for Cloud.

Positionnement correct:

> Bevoac V5.1 est une API Azure-first d'audit declenche, orientee restitution JSON/PDF et integration B2B. Elle est plus specialisee et plus etroite qu'une CNAPP complete.

## 3. Microsoft Defender for Cloud

Source officielle: https://learn.microsoft.com/en-us/azure/defender-for-cloud/concept-cloud-security-posture-management

Points verifies par la documentation Microsoft:

- CSPM est une fonctionnalite coeur de Microsoft Defender for Cloud;
- CSPM fournit une visibilite continue et des recommandations actionnables;
- Defender for Cloud evalue Azure, AWS et GCP;
- le secure score aide a suivre le niveau de risque;
- deux plans CSPM existent: Foundational CSPM et Defender CSPM;
- Defender CSPM inclut des capacites avancees comme attack path analysis, risk prioritization et cloud visibility/compliance monitoring.

Formulation Bevoac:

> Microsoft Defender for Cloud est une solution Microsoft de posture cloud continue et multicloud. Bevoac ne cherche pas a le remplacer. Bevoac se positionne comme une API d'audit et de restitution exploitable, utile pour declencher des controles, produire un JSON standardise et generer un rapport PDF de pilotage.

## 4. Wiz

Source officielle: https://www.wiz.io/platform/wiz-cloud

Points verifies par Wiz:

- Wiz met en avant une visibilite agentless et une priorisation des risques;
- Wiz Security Graph aide a comprendre les chemins de compromission;
- Wiz Cloud consolide plusieurs familles: CSPM, Vulnerability Management, CIEM, Container/Kubernetes Security, DSPM, AI-SPM, Compliance, CWP, IaC Scanning;
- Wiz indique couvrir les risques de misconfiguration, vulnerabilites, exposition publique, permissions excessives et donnees sensibles.

Formulation Bevoac:

> Wiz est une plateforme cloud security large. Bevoac V5.1 est beaucoup plus cible: API Azure-first, scan declenche, sortie JSON/PDF, pilote B2B cadre. Bevoac peut etre positionne comme brique d'audit ou d'integration, pas comme CNAPP generaliste.

## 5. Orca Security

Source officielle: https://orca.security/platform/

Points verifies par Orca:

- Orca se positionne comme plateforme CNAPP agentless;
- Orca met en avant sa technologie SideScanning;
- Orca couvre notamment CSPM, CWPP, CIEM, DSPM, Vulnerability Management, API Security, Compliance;
- Orca met en avant la priorisation contextualisee et la visibilite cloud centralisee.

Formulation Bevoac:

> Orca est une plateforme CNAPP agentless couvrant de nombreux domaines cloud security. Bevoac V5.1 est un socle d'audit API-first plus specialise, utile pour industrialiser des scans Azure-first et produire des rapports finding/remediation/evidence.

## 6. Positionnement Bevoac a utiliser

Bevoac V5.1:

- API-first;
- Azure-first;
- oriente audit declenche ou recurrent;
- resultats JSON exploitables;
- PDF finding/remediation/evidence;
- onboarding Microsoft admin consent;
- quotas et billing;
- adapte a un pilote B2B cadre;
- integrable par un partenaire, MSSP, portail interne ou workflow client.

## 7. Ce qu'il faut eviter

- "Bevoac remplace Wiz";
- "Bevoac remplace Defender for Cloud";
- "Bevoac est une CNAPP complete";
- "Bevoac est multicloud livre";
- "Bevoac fournit une conformite garantie".
