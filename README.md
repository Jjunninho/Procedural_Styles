# Procedural Styles

Gere sons MIDI de forma procedural de diversos estilos!

> Repositório: Procedural_Styles
> Descrição: Gere sons MID de forma procedural de diversos estilos !!!

---

## Site publicado

O projeto está publicado no GitHub Pages:

https://jjunninho.github.io/Procedural_Styles/

Visite o site para testar a interface imediatamente sem precisar rodar nada localmente.

---

## Sobre

Este projeto foca na geração procedural de música/MIDI com diferentes estilos. Ele é uma aplicação web estática construída principalmente em JavaScript, com HTML e CSS para a interface. A UI usa a Web Audio API e integra o Magenta (via CDN) para recursos de IA musical.

Linguagens principais (aprox.):
- JavaScript (81.9%)
- CSS (12.3%)
- HTML (5.7%)

---

## Funcionalidades

- Geração procedural de padrões musicais e progressões.
- Exportação para arquivo MIDI a partir da interface.
- Painel experimental de IA (Magenta) para gerar/variar melodias.
- Presets aprendidos calibrados a partir de um dataset MIDI (arquivo `midi_dataset.json`).

---

## Arquivos principais

- `index.html` — interface web (já publicada no Pages).
- `css/` — estilos (ex.: `css/neon.css`).
- `js/` — lógica da UI e integração (ex.: `js/neon_ui.js`, `js/magenta.js`).
- `midi_dataset.json` — estatísticas e clusters usados como presets aprendidos.
- `iniciar.bat` — atalho local do autor (Windows, ativa Conda)

---

## Como testar rapidamente

1. Acesse a versão publicada: https://jjunninho.github.io/Procedural_Styles/

2. Ou rode localmente (recomendado para desenvolvimento):

- Opção A — servidor estático com Node (recomendado):
  - `npx http-server` (na raiz do repositório)
  - Abra `http://localhost:8080`

- Opção B — Python (útil se não tiver Node):
  - Python 3: `python -m http.server 8080`
  - Abra `http://localhost:8080`

Observação: abrir `index.html` diretamente no arquivo (file://) pode limitar algumas APIs e o carregamento de módulos; por isso é recomendado usar um servidor local.

---

## Observações sobre Magenta

O projeto carrega Magenta.js via CDN (jsdelivr / unpkg). Para que os recursos de IA funcionem é necessária conexão com a internet, a menos que os scripts sejam hospedados localmente na pasta `js/`.

Se você quiser que eu adicione a versão do bundle do Magenta ao repositório (para execução offline), eu posso incluí-la em `js/` — avise se quer que eu faça isso.

---

## Contribuindo

Contribuições são bem-vindas!

1. Faça um fork deste repositório.
2. Crie uma branch com sua feature: `git checkout -b feature/nome-da-feature`.
3. Faça commits com mensagens claras e descritivas.
4. Abra um Pull Request descrevendo as mudanças.

Para issues ou sugestões de estilos/presets, abra uma Issue descrevendo o que você gostaria de ver.

---

## Licença

Adicione aqui a licença do projeto (por exemplo: MIT). Se desejar, eu posso criar um arquivo `LICENSE` com a licença MIT para você — diga se quer que eu adicione.

---

## Contato

Se quiser que eu:
- adicione o bundle do Magenta para execução offline;
- crie um workflow para deploy automático (eu gerei um e posso commitar se você me der permissão);
- inclua um `LICENSE` (MIT) e badging;
- ou melhore o README com screenshots e instruções detalhadas — diga qual opção prefere e eu faço.
