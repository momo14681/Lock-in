Attribute VB_Name = "AppliquerModifsDEM"
' =============================================================================
' Applique dans la DEM les modifications saisies dans le tableau de bord
' (fichier "Modifications_DEM_....txt" telecharge depuis la vue
' "Modifications a appliquer").
'
' Utilisation : ouvrir la DEM dans Excel (application de bureau), puis
' Developpeur > Macros > AppliquerModifsDEM (ou Alt+F8).
'
' Pour chaque modification, la macro :
'   1. retrouve la ligne par feuille + affaire + REE + OT + TOT (colonnes A, D, J, K),
'      meme si des lignes ont ete inserees depuis la saisie ;
'   2. verifie que la cellule contient toujours la valeur vue lors de la saisie ;
'      sinon la modification est ecartee (quelqu'un l'a changee entre-temps) ;
'   3. montre le bilan et demande confirmation avant d'ecrire quoi que ce soit.
' Un compte rendu s'ouvre dans un nouveau classeur. La DEM n'est pas enregistree
' automatiquement : relire puis enregistrer.
' =============================================================================
Option Explicit

Private Const COL_AFFAIRE As Long = 1   ' A
Private Const COL_REE As Long = 4       ' D
Private Const COL_OT As Long = 10       ' J
Private Const COL_TOT As Long = 11      ' K

' Index des champs d'une modification (colonnes du fichier, puis resultat de l'analyse).
Private Const F_FEUILLE As Long = 0
Private Const F_LIGNE As Long = 1
Private Const F_CELLULE As Long = 2
Private Const F_CHAMP As Long = 3
Private Const F_AFFAIRE As Long = 4
Private Const F_REE As Long = 5
Private Const F_OT As Long = 6
Private Const F_TOT As Long = 7
Private Const F_ANCIENNE As Long = 8
Private Const F_NOUVELLE As Long = 9
Private Const F_TYPE As Long = 10
Private Const F_CHARGE As Long = 11
Private Const F_STATUT As Long = 13
Private Const F_ADRESSE As Long = 14
Private Const F_MESSAGE As Long = 15
Private Const F_AFFICHAGE As Long = 16

Public Sub AppliquerModifsDEM()
    Dim wb As Workbook, chemin As Variant, contenu As String, lignes() As String
    Dim modifs As Collection, m As Variant, i As Long, ligne As String
    Dim nOk As Long, nDeja As Long, nEcart As Long, apercu As String, nApercu As Long

    Set wb = ActiveWorkbook
    If wb Is Nothing Then
        MsgBox "Ouvrez d'abord la DEM, puis relancez la macro.", vbExclamation, "Modifications DEM"
        Exit Sub
    End If

    chemin = Application.GetOpenFilename("Modifications du tableau de bord (*.txt),*.txt", , "Choisir le fichier de modifications")
    If VarType(chemin) = vbBoolean Then Exit Sub

    contenu = Replace(LireUtf8(CStr(chemin)), ChrW(65279), "")
    lignes = Split(Replace(contenu, vbCr, ""), vbLf)
    If UBound(lignes) < 1 Or Left(lignes(0), 17) <> "DEM_MODIFICATIONS" Then
        MsgBox "Ce fichier n'est pas un fichier de modifications du tableau de bord.", vbExclamation, "Modifications DEM"
        Exit Sub
    End If

    Set modifs = New Collection
    For i = 2 To UBound(lignes)
        ligne = lignes(i)
        If Len(Trim(ligne)) > 0 Then modifs.Add Analyser(wb, Split(ligne, vbTab))
    Next i
    If modifs.Count = 0 Then
        MsgBox "Le fichier ne contient aucune modification.", vbInformation, "Modifications DEM"
        Exit Sub
    End If

    For Each m In modifs
        Select Case m(F_STATUT)
            Case "A appliquer"
                nOk = nOk + 1
                If nApercu < 8 Then
                    ' MsgBox est limite a 1024 caracteres : apercu court.
                    apercu = apercu & vbLf & "  " & Left(m(F_FEUILLE) & "!" & m(F_ADRESSE) & "  " & m(F_CHAMP) & " : " & _
                        IIf(m(F_ANCIENNE) = "", "vide", m(F_ANCIENNE)) & " -> " & IIf(m(F_AFFICHAGE) = "", "vide", m(F_AFFICHAGE)), 70)
                    nApercu = nApercu + 1
                End If
            Case "Déjà dans la DEM"
                nDeja = nDeja + 1
            Case Else
                nEcart = nEcart + 1
        End Select
    Next m
    If nOk > nApercu Then apercu = apercu & vbLf & "  ... et " & (nOk - nApercu) & " autre(s)"

    If nOk = 0 Then
        MsgBox "Aucune modification à appliquer." & vbLf & nDeja & " déjà dans la DEM, " & nEcart & " écartée(s)." & vbLf & _
            "Le compte rendu va s'ouvrir.", vbInformation, "Modifications DEM"
    ElseIf MsgBox("Classeur : " & wb.Name & vbLf & vbLf & nOk & " modification(s) à appliquer :" & apercu & vbLf & vbLf & _
            nDeja & " déjà dans la DEM, " & nEcart & " écartée(s) (voir le compte rendu)." & vbLf & vbLf & _
            "Appliquer maintenant ? (Ctrl+Z ne pourra pas annuler la macro.)", vbYesNo + vbQuestion, "Modifications DEM") = vbYes Then
        For i = 1 To modifs.Count
            m = modifs(i)
            If m(F_STATUT) = "A appliquer" Then
                m = Ecrire(wb, m)
                modifs.Remove i
                If i > modifs.Count Then modifs.Add m Else modifs.Add m, Before:=i
            End If
        Next i
    Else
        For i = 1 To modifs.Count
            m = modifs(i)
            If m(F_STATUT) = "A appliquer" Then
                m(F_STATUT) = "Non appliquée"
                m(F_MESSAGE) = "Annulé avant écriture"
                modifs.Remove i
                If i > modifs.Count Then modifs.Add m Else modifs.Add m, Before:=i
            End If
        Next i
    End If

    CompteRendu modifs, CStr(chemin), wb.Name
End Sub

' Retrouve la ligne et la cellule, puis compare la valeur actuelle a celle vue lors de la saisie.
Private Function Analyser(wb As Workbook, f() As String) As Variant
    Dim m(0 To 16) As Variant, i As Long, ws As Worksheet, r As Long, c As Long, cible As Range
    Dim actuelle As String
    For i = 0 To 12
        If i <= UBound(f) Then m(i) = Decoder(f(i)) Else m(i) = ""
    Next i
    m(F_ADRESSE) = m(F_CELLULE)
    m(F_AFFICHAGE) = m(F_NOUVELLE)
    Analyser = m
    If UBound(f) < 10 Then
        m(F_STATUT) = "Erreur": m(F_MESSAGE) = "Ligne du fichier illisible"
        Analyser = m: Exit Function
    End If
    If m(F_TYPE) = "date" Then m(F_AFFICHAGE) = TexteDate(DateIso(CStr(m(F_NOUVELLE))))

    On Error Resume Next
    Set ws = wb.Worksheets(CStr(m(F_FEUILLE)))
    c = ws.Range(CStr(m(F_CELLULE))).Column
    On Error GoTo 0
    If ws Is Nothing Or c = 0 Then
        m(F_STATUT) = "Introuvable": m(F_MESSAGE) = "Feuille " & m(F_FEUILLE) & " absente de ce classeur"
        Analyser = m: Exit Function
    End If

    r = TrouverLigne(ws, Val(m(F_LIGNE)), CStr(m(F_AFFAIRE)), CStr(m(F_REE)), CStr(m(F_OT)), CStr(m(F_TOT)))
    If r < 0 Then
        m(F_STATUT) = "Introuvable": m(F_MESSAGE) = "Plusieurs lignes ont cette affaire, ce REE, cet OT et cette TOT"
        Analyser = m: Exit Function
    ElseIf r = 0 Then
        m(F_STATUT) = "Introuvable": m(F_MESSAGE) = "Affaire / REE / OT / TOT non retrouvés dans la feuille"
        Analyser = m: Exit Function
    End If

    Set cible = ws.Cells(r, c).MergeArea.Cells(1, 1)
    m(F_ADRESSE) = cible.Address(False, False)
    actuelle = Texte(cible.Value)
    If Norme(actuelle) = Norme(CStr(m(F_AFFICHAGE))) Then
        m(F_STATUT) = "Déjà dans la DEM"
    ElseIf Norme(actuelle) <> Norme(CStr(m(F_ANCIENNE))) Then
        m(F_STATUT) = "Écartée"
        m(F_MESSAGE) = "La cellule a changé depuis la saisie : " & IIf(actuelle = "", "vide", actuelle) & _
            " (attendu : " & IIf(m(F_ANCIENNE) = "", "vide", m(F_ANCIENNE)) & ")"
    Else
        m(F_STATUT) = "A appliquer"
    End If
    If r <> Val(m(F_LIGNE)) And m(F_MESSAGE) = "" Then m(F_MESSAGE) = "Ligne déplacée : " & m(F_LIGNE) & " -> " & r
    Analyser = m
End Function

Private Function Ecrire(wb As Workbook, m As Variant) As Variant
    Dim cible As Range
    On Error GoTo Echec
    Set cible = wb.Worksheets(CStr(m(F_FEUILLE))).Range(CStr(m(F_ADRESSE)))
    Select Case m(F_TYPE)
        Case "date": cible.Value = DateIso(CStr(m(F_NOUVELLE)))
        Case "vide": cible.MergeArea.ClearContents
        Case Else
            ' Un nombre reste un nombre ; tout autre texte est force en texte (apostrophe)
            ' pour qu'Excel ne le transforme pas en date ou en formule.
            If IsNumeric(m(F_NOUVELLE)) Then cible.Value = CStr(m(F_NOUVELLE)) Else cible.Value = "'" & CStr(m(F_NOUVELLE))
    End Select
    m(F_STATUT) = "Appliquée"
    Ecrire = m
    Exit Function
Echec:
    m(F_STATUT) = "Erreur"
    m(F_MESSAGE) = "Écriture impossible : " & Err.Description
    Ecrire = m
End Function

' Ligne attendue d'abord, sinon recherche dans toute la feuille. 0 = absente, -1 = ambigue.
Private Function TrouverLigne(ws As Worksheet, attendue As Long, affaire As String, ree As String, ot As String, tot As String) As Long
    Dim r As Long, derniere As Long, trouve As Long
    If attendue >= 2 Then
        If Correspond(ws, attendue, affaire, ree, ot, tot) Then TrouverLigne = attendue: Exit Function
    End If
    derniere = ws.Cells.Find("*", , xlFormulas, , xlByRows, xlPrevious).Row
    For r = 2 To derniere
        If Correspond(ws, r, affaire, ree, ot, tot) Then
            If trouve > 0 Then TrouverLigne = -1: Exit Function
            trouve = r
        End If
    Next r
    TrouverLigne = trouve
End Function

Private Function Correspond(ws As Worksheet, r As Long, affaire As String, ree As String, ot As String, tot As String) As Boolean
    Correspond = Norme(Valeur(ws, r, COL_AFFAIRE)) = Norme(affaire) And Norme(Valeur(ws, r, COL_REE)) = Norme(ree) _
        And Norme(Valeur(ws, r, COL_OT)) = Norme(ot) And Norme(Valeur(ws, r, COL_TOT)) = Norme(tot)
End Function

' Valeur d'une cellule, y compris dans une plage fusionnee (coin superieur gauche).
Private Function Valeur(ws As Worksheet, r As Long, c As Long) As String
    Valeur = Texte(ws.Cells(r, c).MergeArea.Cells(1, 1).Value)
End Function

' Meme ecriture que le tableau de bord : dates jj/mm/aaaa, nombres sans separateur de milliers.
Private Function Texte(v As Variant) As String
    If IsError(v) Then
        Texte = "#ERREUR"
    ElseIf IsEmpty(v) Then
        Texte = ""
    ElseIf VarType(v) = vbDate Then
        Texte = TexteDate(CDate(v))
    ElseIf VarType(v) = vbDouble Or VarType(v) = vbCurrency Or VarType(v) = vbLong Or VarType(v) = vbInteger Then
        If v = Int(v) And Abs(v) < 1E+15 Then Texte = Format(v, "0") Else Texte = Replace(CStr(v), Application.International(xlDecimalSeparator), ".")
    Else
        Texte = Trim(Replace(CStr(v), ChrW(160), " "))
    End If
End Function

Private Function TexteDate(d As Date) As String
    TexteDate = Right("0" & Day(d), 2) & "/" & Right("0" & Month(d), 2) & "/" & Year(d)
End Function

Private Function DateIso(s As String) As Date
    DateIso = DateSerial(CInt(Left(s, 4)), CInt(Mid(s, 6, 2)), CInt(Mid(s, 9, 2)))
End Function

' Comparaison sans casse ni espaces superflus.
Private Function Norme(s As String) As String
    Dim t As String
    t = Trim(Replace(Replace(Replace(s, ChrW(160), " "), vbTab, " "), vbCr, ""))
    Do While InStr(t, "  ") > 0
        t = Replace(t, "  ", " ")
    Loop
    Norme = UCase(t)
End Function

' Le fichier code les retours a la ligne en \n et les barres obliques inverses en \\.
Private Function Decoder(s As String) As String
    Dim i As Long, c As String, out As String
    i = 1
    Do While i <= Len(s)
        c = Mid(s, i, 1)
        If c = "\" And i < Len(s) Then
            Select Case Mid(s, i + 1, 1)
                Case "n": out = out & vbLf: i = i + 2
                Case "\": out = out & "\": i = i + 2
                Case Else: out = out & c: i = i + 1
            End Select
        Else
            out = out & c: i = i + 1
        End If
    Loop
    Decoder = out
End Function

Private Function LireUtf8(chemin As String) As String
    Dim flux As Object
    Set flux = CreateObject("ADODB.Stream")
    flux.Type = 2
    flux.Charset = "utf-8"
    flux.Open
    flux.LoadFromFile chemin
    LireUtf8 = flux.ReadText
    flux.Close
End Function

Private Sub CompteRendu(modifs As Collection, fichier As String, classeur As String)
    Dim rapport As Workbook, ws As Worksheet, m As Variant, r As Long
    Set rapport = Workbooks.Add
    Set ws = rapport.Worksheets(1)
    ws.Name = "Compte rendu"
    ws.Range("A1").Value = "Modifications du tableau de bord appliquées à " & classeur & " le " & Format(Now, "dd/mm/yyyy hh:nn")
    ws.Range("A2").Value = "Fichier : " & fichier
    ws.Range("A4:L4").Value = Array("Résultat", "Détail", "Feuille", "Cellule", "Champ", "Affaire", "REE", "OT", "TOT", "Ancienne valeur", "Nouvelle valeur", "Chargé")
    ws.Range("A4:L4").Font.Bold = True
    r = 5
    For Each m In modifs
        ws.Cells(r, 1).Value = m(F_STATUT)
        ws.Cells(r, 2).Value = m(F_MESSAGE)
        ws.Cells(r, 3).Value = m(F_FEUILLE)
        ws.Cells(r, 4).Value = m(F_ADRESSE)
        ws.Cells(r, 5).Value = m(F_CHAMP)
        ws.Range(ws.Cells(r, 6), ws.Cells(r, 12)).NumberFormat = "@"
        ws.Cells(r, 6).Value = m(F_AFFAIRE)
        ws.Cells(r, 7).Value = m(F_REE)
        ws.Cells(r, 8).Value = m(F_OT)
        ws.Cells(r, 9).Value = m(F_TOT)
        ws.Cells(r, 10).Value = m(F_ANCIENNE)
        ws.Cells(r, 11).Value = m(F_AFFICHAGE)
        ws.Cells(r, 12).Value = m(F_CHARGE)
        r = r + 1
    Next m
    ws.Columns("A:L").AutoFit
    ws.Range("A4:L4").AutoFilter
End Sub
