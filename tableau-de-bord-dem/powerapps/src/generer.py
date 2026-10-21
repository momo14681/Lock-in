"""Génère les écrans Power Apps (YAML à coller dans Power Apps Studio) et les formules.

    python3 powerapps/src/generer.py

Écrit powerapps/ecrans/*.pa.yaml et powerapps/App.Formulas.fr.txt (séparateurs français).
Les formules sont écrites en syntaxe invariante (« , » entre arguments, « ; » entre actions),
celle du YAML collé dans Power Apps Studio.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ecrans"

# Charte EDF
NAVY, BLUE, ORANGE = "RGBA(0, 26, 112, 1)", "RGBA(16, 87, 200, 1)", "RGBA(254, 88, 21, 1)"
BG, WHITE, INK, MUTED, LINE = "RGBA(243, 245, 248, 1)", "RGBA(255, 255, 255, 1)", "RGBA(0, 26, 112, 1)", "RGBA(90, 102, 120, 1)", "RGBA(220, 226, 234, 1)"
GOOD, BAD, WARN, NONE = "RGBA(80, 158, 47, 1)", "RGBA(227, 38, 45, 1)", "RGBA(170, 110, 0, 1)", "RGBA(0, 0, 0, 0)"
ETAT_COLOR = f'Switch(ThisItem.Etat, "Réalisé", {GOOD}, "Prépa en retard", {BAD}, "Infos manquantes", {WARN}, "Prépa terminée", {BLUE}, {MUTED})'


def scalar(v, indent):
    """Valeur de propriété : formule précédée de « = », en bloc littéral si nécessaire."""
    f = "=" + str(v)
    if "\n" in f or re.search(r'[:#"\'{}\[\],&*!|>%@`]', f[1:]) or f.endswith(" "):
        pad = " " * (indent + 2)
        return "|-\n" + "\n".join(pad + line for line in f.split("\n"))
    return f


def emit(controls, indent):
    out = []
    for c in controls:
        pad = " " * indent
        out.append(f"{pad}- {c['name']}:")
        out.append(f"{pad}    Control: {c['type']}")
        if c.get("variant"):
            out.append(f"{pad}    Variant: {c['variant']}")
        if c.get("props"):
            out.append(f"{pad}    Properties:")
            for k, v in c["props"].items():
                out.append(f"{pad}      {k}: {scalar(v, indent + 6)}")
        if c.get("children"):
            out.append(f"{pad}    Children:")
            out.extend(emit(c["children"], indent + 6))
    return out


def screen(name, props, children):
    lines = ["Screens:", f"  {name}:", "    Properties:"]
    for k, v in props.items():
        lines.append(f"      {k}: {scalar(v, 6)}")
    lines.append("    Children:")
    lines.extend(emit(children, 6))
    return "\n".join(lines) + "\n"


def C(name, typ, variant=None, children=None, **props):
    return {"name": name, "type": typ, "variant": variant, "props": props, "children": children}


def label(name, text, x, y, w, h, size=13, color=INK, **more):
    return C(name, "Label", Text=text, X=x, Y=y, Width=w, Height=h, Size=size, Color=color, **more)


def button(name, text, x, y, w, h, onselect, fill=BLUE, color=WHITE, **more):
    p = dict(Text=text, X=x, Y=y, Width=w, Height=h, OnSelect=onselect, Fill=fill, Color=color,
             HoverFill=f"ColorFade(Self.Fill, -15%)", PressedFill=f"ColorFade(Self.Fill, -25%)", HoverColor="Self.Color",
             BorderThickness=0, Size=12, RadiusTopLeft=6, RadiusTopRight=6, RadiusBottomLeft=6, RadiusBottomRight=6)
    p.update(more)
    return C(name, "Classic/Button", **p)


def rect(name, x, y, w, h, fill=WHITE, **more):
    return C(name, "Rectangle", X=x, Y=y, Width=w, Height=h, Fill=fill, **more)


NAV = [("Accueil", "scrAccueil"), ("Mes TOT", "scrTOT"), ("Mon pilotage", "scrPilotage"), ("Équipe", "scrEquipe")]


def header(s, active, subtitle=None):
    ctl = [
        rect(f"{s}Bandeau", 0, 0, "Parent.Width", 64, NAVY),
        label(f"{s}Titre", '"Pilotage des essais"', 24, 8, 400, 28, 17, WHITE),
        label(f"{s}SousTitre", subtitle or '"DEM · " & If(gCoordo, "Coordo essais", Coalesce(gMoi, "chargé non choisi"))', 24, 34, 520, 22, 11, "RGBA(200, 210, 235, 1)"),
    ]
    for i, (txt, target) in enumerate(NAV):
        on = target == active
        ctl.append(button(f"{s}Nav{i}", f'"{txt}"', f"Parent.Width - {(len(NAV) - i) * 150 + 16}", 12, 140, 40,
                          f"Navigate({target}, ScreenTransition.None)", WHITE if on else NONE, NAVY if on else WHITE))
    return ctl


def tile(s, i, x, y, w, value, caption, onselect, color=INK):
    return [
        rect(f"{s}Carte{i}", x, y, w, 116, WHITE, BorderColor=LINE, BorderThickness=1, OnSelect=onselect),
        label(f"{s}Valeur{i}", value, x + 20, y + 16, w - 40, 48, 30, color, OnSelect=onselect),
        label(f"{s}Legende{i}", caption, x + 20, y + 66, w - 40, 40, 12, MUTED, OnSelect=onselect, VerticalAlign="VerticalAlign.Top"),
    ]


def pct(cond):
    return f'Text(If(CountRows(tMes) = 0, 0, CountRows(Filter(tMes, {cond})) / CountRows(tMes)), "0%")'


def frac(cond, unit="TOT"):
    return f'Text(CountRows(Filter(tMes, {cond}))) & " / " & Text(CountRows(tMes)) & " {unit}"'


# --- Accueil ---------------------------------------------------------------------------

# Lecture de la vraie DEM en un seul appel : flux Power Automate « DEM_PowerApps » qui exécute
# le script Office DEM_PowerApps (cellules fusionnées résolues, dates en jj/mm/aaaa).
CHARGER = """With(
    {reponse: ParseJSON(DEM_PowerApps.Run("lire", "").resultat)},
    ClearCollect(
        colSrc,
        ForAll(
            Table(reponse.lignes) As x,
            {
                Num: Value(x.Value.Num),
                Ligne: Value(x.Value.Ligne),
                Cle: Text(x.Value.Cle),
                Feuille: Text(x.Value.Feuille),
                Affaire: Text(x.Value.Affaire),
                Libelle: Text(x.Value.Libelle),
                REE: Text(x.Value.REE),
                Titulaire: Text(x.Value.Titulaire),
                LibelleREE: Text(x.Value.LibelleREE),
                MC: Text(x.Value.MC),
                OT: Text(x.Value.OT),
                TOT: Text(x.Value.TOT),
                RDU: Text(x.Value.RDU),
                Charge: Text(x.Value.Charge),
                TOTPrete: Text(x.Value.TOTPrete),
                J0: Text(x.Value.J0),
                Regime: Text(x.Value.Regime),
                BPA: Text(x.Value.BPA),
                GER1N: Text(x.Value.GER1N),
                BPD: Text(x.Value.BPD),
                Observations: Text(x.Value.Observations)
            }
        )
    )
);
Set(gMaj, Now());
If(
    IsBlank(gMoi),
    Set(
        gMoi,
        First(
            Filter(
                Distinct(Filter(tDEM, !Annulee), Charge) As c,
                CountRows(Filter(Split(User().FullName, " ") As w, Len(w.Value) > 1 && !(Lower(w.Value) in Lower(c.Value)))) = 0
            )
        ).Value
    )
)"""

BPA30 = "!BpaFait && !IsBlank(J0Date) && J0Date < DateAdd(Today(), 30)"
GEL30 = "!Gelee && !IsBlank(GelM0) && GelM0 < DateAdd(Today(), 30)"


def accueil():
    s = "acc"
    W, X0, GAP = 300, 40, 24
    xs = [X0 + i * (W + GAP) for i in range(4)]
    ctl = header(s, "scrAccueil")
    ctl += [
        label(f"{s}Profil", '"Profil"', 40, 84, 100, 24, 12, MUTED),
        button(f"{s}ModeCharge", '"Chargé d’essais"', 40, 110, 170, 36, "Set(gCoordo, false)", "If(gCoordo, " + WHITE + ", " + NAVY + ")", "If(gCoordo, " + NAVY + ", " + WHITE + ")", BorderThickness=1, BorderColor=NAVY),
        button(f"{s}ModeCoordo", '"Coordo essais"', 216, 110, 170, 36, "Set(gCoordo, true)", "If(gCoordo, " + NAVY + ", " + WHITE + ")", "If(gCoordo, " + WHITE + ", " + NAVY + ")", BorderThickness=1, BorderColor=NAVY),
        label(f"{s}ChoixLib", '"Chargé d’essais"', 420, 84, 300, 24, 12, MUTED),
        C(f"{s}Charge", "Classic/DropDown", Items="Sort(Distinct(Filter(tDEM, !Annulee), Charge), Value)", Default="gMoi",
          OnChange="Set(gMoi, Self.Selected.Value)", X=420, Y=110, Width=320, Height=36, Size=12, DisplayMode="If(gCoordo, DisplayMode.Disabled, DisplayMode.Edit)"),
        label(f"{s}Maj", 'If(IsBlank(gMaj), "Chargement de la DEM…", "Données lues à " & Text(gMaj, "hh:mm") & " · " & Text(CountRows(colSrc)) & " lignes")', "Parent.Width - 520", 110, 340, 36, 11, MUTED, Align="Align.Right"),
        button(f"{s}Actualiser", '"Actualiser"', "Parent.Width - 168", 110, 128, 36, CHARGER, WHITE, NAVY, BorderThickness=1, BorderColor=NAVY),
    ]
    rows = [
        ("Text(CountRows(tMes))", '"TOT suivies · " & Text(CountRows(Distinct(tMes, Affaire & REE))) & " REE"', 'Set(gFiltre, "Tous les états"); Navigate(scrTOT, ScreenTransition.None)', INK),
        (pct("TotPreteOk"), '"Préparation terminée · " & ' + frac("TotPreteOk"), 'Set(gFiltre, "Prépa terminée"); Navigate(scrTOT, ScreenTransition.None)', BLUE),
        (pct("Realise"), '"Essais réalisés (GER/1N signé) · " & ' + frac("Realise"), 'Set(gFiltre, "Réalisé"); Navigate(scrTOT, ScreenTransition.None)', GOOD),
        (pct("BpdSigne"), '"BPD signés · " & ' + frac("BpdSigne"), "Navigate(scrPilotage, ScreenTransition.None)", INK),
        ("Text(CountRows(Filter(tMes, Retard)))", '"Prépas en retard (J0 − 30 j passé, TOT pas prête)"', 'Set(gFiltre, "Prépa en retard"); Navigate(scrTOT, ScreenTransition.None)', f"If(CountRows(Filter(tMes, Retard)) > 0, {BAD}, {INK})"),
        ("Text(CountRows(Filter(tMes, InfosManquantes)))", '"Infos manquantes (MC, OT, TOT ou TOT prête)"', 'Set(gFiltre, "Infos manquantes"); Navigate(scrTOT, ScreenTransition.None)', f"If(CountRows(Filter(tMes, InfosManquantes)) > 0, {WARN}, {INK})"),
        (f"Text(CountRows(Distinct(Filter(tMes, {BPA30}), Affaire & REE)))", '"REE avec BPA à faire, J0 sous 30 jours"', 'Set(gFenetre, "Moins de 30 jours"); Navigate(scrPilotage, ScreenTransition.None)', INK),
        (f"Text(CountRows(Distinct(Filter(tMes, {GEL30}), Affaire & REE)))", '"REE à passer en Gel M0 sous 30 jours"', 'Set(gFenetre, "Moins de 30 jours"); Navigate(scrPilotage, ScreenTransition.None)', INK),
    ]
    for i, (v, cap, on, col) in enumerate(rows):
        ctl += tile(s, i, xs[i % 4], 176 + (i // 4) * 140, W, v, cap, on, col)
    ctl.append(label(f"{s}Aide", '"Touchez une carte pour ouvrir la liste correspondante. Les modifications faites dans la fiche d’une TOT sont écrites directement dans la DEM."', 40, 470, 1000, 40, 11, MUTED))
    return screen("scrAccueil", {"Fill": BG, "OnVisible": "If(CountRows(colSrc) = 0,\n" + CHARGER + "\n)"}, ctl)


# --- Mes TOT -------------------------------------------------------------------------

ETATS = ["Tous les états", "Prépa en retard", "Infos manquantes", "En préparation", "Prépa terminée", "Réalisé"]


def liste_tot():
    s = "tot"
    items = ('Sort(Filter(tMes, (ddEtat.Selected.Value = "Tous les états" || Etat = ddEtat.Selected.Value) && '
             '(IsBlank(txtRecherche.Text) || txtRecherche.Text in Affaire || txtRecherche.Text in REE || txtRecherche.Text in OT || '
             'txtRecherche.Text in Libelle || txtRecherche.Text in LibelleREE)), J0Date, SortOrder.Ascending)')
    rowctl = [
        rect("totLigneFond", 0, 0, "Parent.TemplateWidth", "Parent.TemplateHeight - 1", WHITE, OnSelect="Select(Parent)"),
        label("totLigneTitre", 'ThisItem.Affaire & " · REE " & ThisItem.REE & " · " & ThisItem.LibelleREE', 16, 8, 560, 24, 13, BLUE, OnSelect="Select(Parent)"),
        label("totLigneSous", '"TOT " & ThisItem.OT & "-" & ThisItem.TOT & " · " & ThisItem.Feuille & " ligne " & Text(ThisItem.Ligne) & If(gCoordo, " · " & ThisItem.Charge, "")', 16, 34, 560, 22, 11, MUTED, OnSelect="Select(Parent)"),
        label("totLigneJ0", '"J0 " & If(IsBlank(ThisItem.J0Date), Coalesce(ThisItem.J0, "—"), Text(ThisItem.J0Date, "dd/mm/yyyy"))', 590, 8, 170, 24, 12, INK, OnSelect="Select(Parent)"),
        label("totLigneEtat", "ThisItem.Etat", 590, 34, 170, 22, 11, ETAT_COLOR, OnSelect="Select(Parent)"),
        label("totLigneDocs", '"TOT prête " & Coalesce(ThisItem.TOTPrete, "—") & "    BPA " & Coalesce(ThisItem.BPA, "—") & "    GER/1N " & Coalesce(ThisItem.GER1N, "—") & "    BPD " & Coalesce(ThisItem.BPD, "—")', 780, 8, "Parent.TemplateWidth - 840", 48, 11, MUTED, OnSelect="Select(Parent)"),
        C("totLigneFleche", "Classic/Icon", None, Icon="Icon.ChevronRight", X="Parent.TemplateWidth - 48", Y=16, Width=32, Height=32, Color=MUTED, OnSelect="Select(Parent)"),
    ]
    ctl = header(s, "scrTOT")
    ctl += [
        label(f"{s}TitreListe", 'If(gCoordo, "Toutes les TOT", "Mes TOT") & " · " & Text(CountRows(galTOT.AllItems))', 40, 80, 500, 36, 20, INK),
        C("txtRecherche", "Classic/TextInput", Default='""', HintText='"Rechercher une affaire, un REE, un OT…"', X=40, Y=124, Width=420, Height=36, Size=12, BorderColor=LINE),
        C("ddEtat", "Classic/DropDown", Items="[" + ", ".join(f'"{e}"' for e in ETATS) + "]", Default='Coalesce(gFiltre, "Tous les états")',
          OnChange="Set(gFiltre, Self.Selected.Value)", X=476, Y=124, Width=240, Height=36, Size=12),
        C("galTOT", "Gallery", "BrowseLayout_Vertical_TwoTextOneImageVariant_ver5.0", rowctl, Items=items,
          OnSelect="Set(gSel, ThisItem); Navigate(scrFiche, ScreenTransition.None)", TemplateSize=64, TemplatePadding=0,
          X=40, Y=172, Width="Parent.Width - 80", Height="Parent.Height - 192", Fill=LINE, ShowScrollbar="true"),
    ]
    return screen("scrTOT", {"Fill": BG}, ctl)


# --- Fiche d'une TOT -------------------------------------------------------------------

CHAMPS = [
    ("TOTPrete", "TOT prête", '"jj/mm/aaaa, P, R ou Renseigné"'),
    ("BPA", "BPA", '"jj/mm/aaaa, P, R ou F"'),
    ("GER1N", "GER/1N", '"jj/mm/aaaa, P, PS, TS, PSR, TSR, TAR ou R"'),
    ("BPD", "BPD", '"jj/mm/aaaa, P ou R"'),
    ("J0", "J0", '"jj/mm/aaaa ou Non renseigné"'),
    ("MC", "MC", '""'),
    ("RDU", "RDU", '""'),
    ("Regime", "Régime", '""'),
]

ENREGISTRER = """With(
    {
        tp: Trim(inTOTPrete.Text),
        bpa: Trim(inBPA.Text),
        ger: Trim(inGER1N.Text),
        bpd: Trim(inBPD.Text),
        j0: Trim(inJ0.Text)
    },
    With(
        {
            dtp: IfError(DateValue(tp, "fr-FR"), Blank()),
            dbpa: IfError(DateValue(bpa, "fr-FR"), Blank()),
            dger: IfError(DateValue(ger, "fr-FR"), Blank()),
            dbpd: IfError(DateValue(bpd, "fr-FR"), Blank()),
            dj0: IfError(DateValue(j0, "fr-FR"), Blank())
        },
        With(
            {
                erreurs: Concat(
                    Filter(
                        Table(
                            {champ: "TOT prête", ok: IsBlank(tp) || !IsBlank(dtp) || Upper(tp) in ["P", "R", "PRÊT", "PRET", "RENSEIGNÉ", "RENSEIGNE"] || StartsWith(Upper(tp), "ANNUL")},
                            {champ: "BPA", ok: IsBlank(bpa) || !IsBlank(dbpa) || Upper(bpa) in ["P", "R", "F"] || StartsWith(Upper(bpa), "ANNUL")},
                            {champ: "GER/1N", ok: IsBlank(ger) || !IsBlank(dger) || Upper(ger) in ["P", "PS", "TS", "PSR", "TSR", "TAR", "R"] || StartsWith(Upper(ger), "ANNUL")},
                            {champ: "BPD", ok: IsBlank(bpd) || !IsBlank(dbpd) || Upper(bpd) in ["P", "R"] || StartsWith(Upper(bpd), "ANNUL")},
                            {champ: "J0", ok: IsBlank(j0) || !IsBlank(dj0) || StartsWith(Upper(j0), "NON RENSEIGN")}
                        ) As e,
                        !e.ok
                    ),
                    champ,
                    ", "
                ),
                valeurs: {
                    TOTPrete: If(IsBlank(dtp), tp, Text(dtp, "dd/mm/yyyy")),
                    BPA: If(IsBlank(dbpa), Upper(bpa), Text(dbpa, "dd/mm/yyyy")),
                    GER1N: If(IsBlank(dger), Upper(ger), Text(dger, "dd/mm/yyyy")),
                    BPD: If(IsBlank(dbpd), Upper(bpd), Text(dbpd, "dd/mm/yyyy")),
                    J0: If(IsBlank(dj0), j0, Text(dj0, "dd/mm/yyyy")),
                    MC: Trim(inMC.Text),
                    RDU: Trim(inRDU.Text),
                    Regime: Trim(inRegime.Text),
                    Observations: inObservations.Text
                }
            },
            If(
                !IsBlank(erreurs),
                Notify("Valeur non reconnue pour : " & erreurs & ". Saisir une date jj/mm/aaaa ou un des codes proposés.", NotificationType.Error),
                With(
                    {
                        reponse: ParseJSON(
                            DEM_PowerApps.Run(
                                "ecrire",
                                JSON(
                                    {
                                        feuille: gSel.Feuille,
                                        ligne: gSel.Ligne,
                                        affaire: gSel.Affaire,
                                        ree: gSel.REE,
                                        ot: gSel.OT,
                                        tot: gSel.TOT,
                                        utilisateur: User().FullName,
                                        champs: Filter(
                                            Table(
                                                {colonne: "TOTPrete", ancienne: gSel.TOTPrete, nouvelle: valeurs.TOTPrete},
                                                {colonne: "BPA", ancienne: gSel.BPA, nouvelle: valeurs.BPA},
                                                {colonne: "GER1N", ancienne: gSel.GER1N, nouvelle: valeurs.GER1N},
                                                {colonne: "BPD", ancienne: gSel.BPD, nouvelle: valeurs.BPD},
                                                {colonne: "J0", ancienne: gSel.J0, nouvelle: valeurs.J0},
                                                {colonne: "MC", ancienne: gSel.MC, nouvelle: valeurs.MC},
                                                {colonne: "RDU", ancienne: gSel.RDU, nouvelle: valeurs.RDU},
                                                {colonne: "Regime", ancienne: gSel.Regime, nouvelle: valeurs.Regime},
                                                {colonne: "Observations", ancienne: gSel.Observations, nouvelle: valeurs.Observations}
                                            ) As c,
                                            Coalesce(c.ancienne, "") <> Coalesce(c.nouvelle, "")
                                        )
                                    }
                                )
                            ).resultat
                        )
                    },
                    If(
                        Boolean(reponse.ok),
                        Patch(colSrc, LookUp(colSrc, Num = gSel.Num), valeurs);
                        Set(gSel, LookUp(tDEM, Num = gSel.Num));
                        Notify(Text(reponse.message), NotificationType.Success),
                        Notify(Text(reponse.message), NotificationType.Error)
                    )
                )
            )
        )
    )
)"""


def fiche():
    s = "fic"
    ctl = header(s, "")
    ctl += [
        button(f"{s}Retour", '"‹ Retour à la liste"', 40, 80, 170, 34, "Back()", WHITE, NAVY, BorderThickness=1, BorderColor=NAVY),
        label(f"{s}Titre2", 'gSel.Affaire & " · REE " & gSel.REE', 40, 124, 700, 36, 20, INK),
        label(f"{s}Libelle", 'gSel.Libelle & " · " & gSel.LibelleREE', 40, 160, 900, 24, 12, MUTED),
        label(f"{s}Infos", '"TOT " & gSel.OT & "-" & gSel.TOT & " · " & gSel.Feuille & " ligne " & Text(gSel.Ligne) & " · titulaire " & Coalesce(gSel.Titulaire, "—") & " · chargé " & gSel.Charge', 40, 184, 1000, 24, 12, MUTED),
        label(f"{s}Etat", '"État : " & gSel.Etat & If(IsBlank(gSel.Echeance), "", " · échéance prépa " & Text(gSel.Echeance, "dd/mm/yyyy")) & If(gSel.Gelee, " · ligne gelée", " · manque pour le Gel M0 : " & gSel.ManqueGel)', 40, 210, 1100, 24, 12, INK),
        rect(f"{s}Cadre", 40, 246, "Parent.Width - 80", 400, WHITE, BorderColor=LINE, BorderThickness=1),
    ]
    colw, x0 = 400, 64
    for i, (k, lib, hint) in enumerate(CHAMPS):
        x, y = x0 + (i % 3) * (colw + 24), 266 + (i // 3) * 92
        ctl.append(label(f"lib{k}", f'"{lib}"', x, y, colw, 22, 12, MUTED))
        ctl.append(C(f"in{k}", "Classic/TextInput", Default=f"gSel.{k}", HintText=hint, X=x, Y=y + 24, Width=colw, Height=38, Size=13, BorderColor=LINE))
    xo, yo = x0 + 2 * (colw + 24), 266 + 2 * 92
    ctl.append(label("libObservations", '"Observations"', xo, yo, colw, 22, 12, MUTED))
    ctl.append(C("inObservations", "Classic/TextInput", Default="gSel.Observations", Mode="TextMode.MultiLine", X=xo, Y=yo + 24, Width=colw, Height=110, Size=12, BorderColor=LINE))
    ctl += [
        button(f"{s}Enregistrer", '"Enregistrer dans la DEM"', 64, 586, 230, 42, ENREGISTRER, BLUE, WHITE, Size=13),
        button(f"{s}Annuler", '"Annuler les saisies"', 308, 586, 180, 42,
               "Reset(inTOTPrete); Reset(inBPA); Reset(inGER1N); Reset(inBPD); Reset(inJ0); Reset(inMC); Reset(inRDU); Reset(inRegime); Reset(inObservations)",
               WHITE, NAVY, BorderThickness=1, BorderColor=NAVY),
        label(f"{s}Note", '"Écrit directement dans la DEM (jj/mm/aaaa pour les dates). Si quelqu’un a modifié la ligne entre-temps, rien n’est écrit."', 504, 586, 700, 42, 11, MUTED),
    ]
    return screen("scrFiche", {"Fill": BG}, ctl)


# --- Mon pilotage --------------------------------------------------------------------

FENETRES = ["Moins de 30 jours", "30 à 90 jours", "Plus tard", "Tout"]


def dans_fenetre(d):
    return (f'Switch(ddFenetre.Selected.Value, "Moins de 30 jours", {d} < DateAdd(Today(), 30), '
            f'"30 à 90 jours", {d} >= DateAdd(Today(), 30) && {d} < DateAdd(Today(), 90), '
            f'"Plus tard", {d} >= DateAdd(Today(), 90), true)')


def pilotage():
    s = "pil"
    ctl = header(s, "scrPilotage")
    W, X0, GAP = 300, 40, 24
    kpis = [
        (pct("Gelee"), '"Lignes gelées (MC, OT, TOT, RDU, Régime) · " & ' + frac("Gelee", "")),
        (pct("BpaFait"), '"BPA faits · " & ' + frac("BpaFait", "")),
        (pct("Realise"), '"Essais réalisés · " & ' + frac("Realise", "")),
        (pct("BpdSigne"), '"BPD signés · " & ' + frac("BpdSigne", "")),
    ]
    for i, (v, cap) in enumerate(kpis):
        ctl += tile(s, i, X0 + i * (W + GAP), 80, W, v, cap, "false")
    ctl += [
        label(f"{s}Periode", '"Échéance"', 40, 212, 100, 36, 12, MUTED),
        C("ddFenetre", "Classic/DropDown", Items="[" + ", ".join(f'"{e}"' for e in FENETRES) + "]", Default='Coalesce(gFenetre, "Moins de 30 jours")',
          OnChange="Set(gFenetre, Self.Selected.Value)", X=140, Y=212, Width=240, Height=36, Size=12),
    ]
    half = "(Parent.Width - 104) / 2"
    gel_items = (f'Sort(Filter(AddColumns(GroupBy(Filter(tMes, !Gelee && !IsBlank(GelM0)), Affaire, REE, Lignes), '
                 f'Gel, Min(Lignes, GelM0), Libelle1, First(Lignes).LibelleREE, Manque, First(Lignes).ManqueGel, NbLignes, CountRows(Lignes)), '
                 f'{dans_fenetre("Gel")}), Gel, SortOrder.Ascending)')
    bpa_items = (f'Sort(Filter(AddColumns(GroupBy(Filter(tMes, !BpaFait && !IsBlank(J0Date)), Affaire, REE, Lignes), '
                 f'J0Min, Min(Lignes, J0Date), Libelle1, First(Lignes).LibelleREE, NbLignes, CountRows(Lignes), '
                 f'ParMoi, CountRows(Filter(Lignes, APreparerParMoi)) > 0), {dans_fenetre("J0Min")}), J0Min, SortOrder.Ascending)')

    def liste(prefix, x, titre, items, date_txt, detail_txt):
        rows = [
            rect(f"{prefix}Fond", 0, 0, "Parent.TemplateWidth", "Parent.TemplateHeight - 1", WHITE),
            label(f"{prefix}Ree", 'ThisItem.Affaire & " · REE " & ThisItem.REE', 16, 6, "Parent.TemplateWidth - 180", 24, 13, BLUE),
            label(f"{prefix}Lib", detail_txt, 16, 30, "Parent.TemplateWidth - 180", 22, 11, MUTED),
            label(f"{prefix}Date", date_txt, "Parent.TemplateWidth - 160", 6, 144, 46, 12, INK, Align="Align.Right"),
        ]
        return [
            label(f"{prefix}Titre", titre, x, 262, half, 30, 15, INK),
            C(f"gal{prefix}", "Gallery", "BrowseLayout_Vertical_TwoTextOneImageVariant_ver5.0", rows, Items=items, TemplateSize=58, TemplatePadding=0,
              X=x, Y=298, Width=half, Height="Parent.Height - 318", Fill=LINE, ShowScrollbar="true"),
        ]

    ctl += liste("Gel", 40, '"Gel M0 à passer (J0 − 70 j) · " & Text(CountRows(galGel.AllItems)) & " REE"', gel_items,
                 'Text(ThisItem.Gel, "dd/mm/yyyy")', '"Manque " & ThisItem.Manque & " · " & Text(ThisItem.NbLignes) & " TOT · " & ThisItem.Libelle1')
    ctl += liste("Bpa", f"64 + {half}", '"BPA à faire · " & Text(CountRows(galBpa.AllItems)) & " REE"', bpa_items,
                 '"J0 " & Text(ThisItem.J0Min, "dd/mm/yyyy")', 'Text(ThisItem.NbLignes) & " TOT sans BPA" & If(ThisItem.ParMoi, " · à préparer par moi", "") & " · " & ThisItem.Libelle1')
    return screen("scrPilotage", {"Fill": BG}, ctl)


# --- Équipe (coordo) ---------------------------------------------------------------------

def equipe():
    s = "equ"
    ctl = header(s, "scrEquipe", '"DEM · vue équipe"')
    items = ('Sort(AddColumns(GroupBy(Filter(tDEM, !Annulee), Charge, Lignes), NbTot, CountRows(Lignes), '
             'NbPrepa, CountRows(Filter(Lignes, TotPreteOk)), NbReal, CountRows(Filter(Lignes, Realise)), '
             'NbRetard, CountRows(Filter(Lignes, Retard)), NbInfos, CountRows(Filter(Lignes, InfosManquantes))), NbTot, SortOrder.Descending)')
    bar = 260

    def barre(prefix, x, champ, couleur):
        return [
            rect(f"{prefix}Piste", x, 22, bar, 12, LINE, OnSelect="Select(Parent)"),
            rect(f"{prefix}Plein", x, 22, f"{bar} * ThisItem.{champ} / Max(1, ThisItem.NbTot)", 12, couleur, OnSelect="Select(Parent)"),
            label(f"{prefix}Txt", f'Text(ThisItem.{champ} / Max(1, ThisItem.NbTot), "0%")', x + bar + 8, 12, 60, 32, 12, INK, OnSelect="Select(Parent)"),
        ]

    rows = [
        rect("equFond", 0, 0, "Parent.TemplateWidth", "Parent.TemplateHeight - 1", WHITE, OnSelect="Select(Parent)"),
        label("equNom", "ThisItem.Charge", 16, 6, 260, 26, 13, BLUE, OnSelect="Select(Parent)"),
        label("equNb", 'Text(ThisItem.NbTot) & " TOT"', 16, 30, 260, 22, 11, MUTED, OnSelect="Select(Parent)"),
    ] + barre("equPrepa", 300, "NbPrepa", BLUE) + barre("equReal", 650, "NbReal", GOOD) + [
        label("equRetard", 'Text(ThisItem.NbRetard) & " en retard"', 1000, 6, 140, 46, 12, f"If(ThisItem.NbRetard > 0, {BAD}, {MUTED})", OnSelect="Select(Parent)"),
        label("equInfos", 'Text(ThisItem.NbInfos) & " infos manquantes"', 1140, 6, 170, 46, 12, f"If(ThisItem.NbInfos > 0, {WARN}, {MUTED})", OnSelect="Select(Parent)"),
    ]
    ctl += [
        label(f"{s}TitreListe", '"Avancement par chargé d’essais"', 40, 80, 600, 36, 20, INK),
        label(f"{s}Entete1", '"Préparation (TOT prête)"', 340, 124, 300, 24, 11, MUTED),
        label(f"{s}Entete2", '"Essais réalisés (GER/1N signé)"', 690, 124, 300, 24, 11, MUTED),
        C("galEquipe", "Gallery", "BrowseLayout_Vertical_TwoTextOneImageVariant_ver5.0", rows, Items=items,
          OnSelect='Set(gMoi, ThisItem.Charge); Set(gCoordo, false); Set(gFiltre, "Tous les états"); Navigate(scrTOT, ScreenTransition.None)',
          TemplateSize=58, TemplatePadding=0, X=40, Y=152, Width="Parent.Width - 80", Height="Parent.Height - 172", Fill=LINE, ShowScrollbar="true"),
    ]
    return screen("scrEquipe", {"Fill": BG}, ctl)


# --- Formules en séparateurs français -------------------------------------------------------

def vers_francais(src):
    """« , » → « ; » et « ; » → « ;; » hors chaînes et commentaires (pas de décimales dans nos formules)."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '"':
            j = i + 1
            while j < n and not (src[j] == '"' and (j + 1 >= n or src[j + 1] != '"')):
                j += 2 if src[j] == '"' else 1
            out.append(src[i:j + 1]); i = j + 1
        elif src.startswith("//", i):
            j = src.find("\n", i); j = n if j < 0 else j
            out.append(src[i:j]); i = j
        elif c == ";":
            out.append(";;"); i += 1
        elif c == ",":
            out.append(";"); i += 1
        else:
            out.append(c); i += 1
    return "".join(out)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, fn in [("1-Accueil", accueil), ("2-MesTOT", liste_tot), ("3-FicheTOT", fiche), ("4-MonPilotage", pilotage), ("5-Equipe", equipe)]:
        (OUT / f"{name}.pa.yaml").write_text(fn(), encoding="utf-8")
    src = (ROOT / "App.Formulas.txt").read_text(encoding="utf-8")
    fr = vers_francais(src).replace("version séparateurs anglais « , » et « ; »", "version séparateurs français « ; » et « ;; »")
    (ROOT / "App.Formulas.fr.txt").write_text(fr, encoding="utf-8")
    # Formules à remplacer à la main dans une appli déjà installée (séparateurs français).
    charge = "If(CountRows(colSrc) = 0,\n" + CHARGER + "\n)"
    blocs = [("Écran scrAccueil, propriété OnVisible", charge), ("Bouton accActualiser, propriété OnSelect", CHARGER),
             ("Bouton ficEnregistrer (écran scrFiche), propriété OnSelect", ENREGISTRER)]
    texte = "\n\n".join(f"// ===== {titre} =====\n{vers_francais(f)}" for titre, f in blocs)
    (ROOT / "Formules_a_remplacer.fr.txt").write_text(texte + "\n", encoding="utf-8")
    print("ok", sorted(p.name for p in OUT.iterdir()))
