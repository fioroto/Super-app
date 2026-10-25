// O Mermaid traz o motor de layout ELK (1,4 MB) só para o layout opcional `elk`. O app usa
// sempre o layout padrão (dagre); este trecho ocupa o lugar do ELK no pacote e avisa se alguém pedir.
export default class ELK {
  layout(): Promise<never> {
    return Promise.reject(new Error('O layout "elk" não está incluído neste app. Remova a opção "layout: elk" do diagrama.'));
  }
}
