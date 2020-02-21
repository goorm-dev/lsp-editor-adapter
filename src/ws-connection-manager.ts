import * as rpc from '@sourcegraph/vscode-ws-jsonrpc';
import { ConsoleLogger } from '@sourcegraph/vscode-ws-jsonrpc';
import * as events from 'events';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { ServerCapabilities } from 'vscode-languageserver-protocol';
import { registerServerCapability, unregisterServerCapability } from './server-capability-registration';
import { ILspOptions } from './types';

interface IFilesServerClientCapabilities {
  /* ... all fields from the base ClientCapabilities ... */

  /**
   * The client provides support for workspace/xfiles.
   */
  xfilesProvider?: boolean;
  /**
   * The client provides support for textDocument/xcontent.
   */
  xcontentProvider?: boolean;
}
type ExtendedClientCapabilities = lsProtocol.ClientCapabilities & IFilesServerClientCapabilities;

class LspWsConnectionManager extends events.EventEmitter {
  private isConnected = false;
  private isInitialized = false;
  private socket: WebSocket;
  private documentInfo: ILspOptions;
  private serverCapabilities: lsProtocol.ServerCapabilities;
  private connection: rpc.MessageConnection;
  
  constructor(options: ILspOptions) {
    super();
    this.documentInfo = options;
  }
  
  /**
   * Initialize a connection over a web socket that speaks the LSP protocol
   */
  public connect(socket: WebSocket): this {
    this.socket = socket;

    rpc.listen({
      webSocket: this.socket,
      logger: new ConsoleLogger(),
      onConnection: (connection: rpc.MessageConnection) => {
        connection.listen();
        this.isConnected = true;

        this.connection = connection;
        
        this.emit('connected');
        
        this.sendInitialize();

        this.connection.onNotification('textDocument/publishDiagnostics', (
          params: lsProtocol.PublishDiagnosticsParams,
        ) => {
          this.emit('diagnostic', params);
        });

        this.connection.onNotification('window/showMessage', (params: lsProtocol.ShowMessageParams) => {
          this.emit('logging', params);
        });

        this.connection.onRequest('client/registerCapability', (params: lsProtocol.RegistrationParams) => {
          params.registrations.forEach((capabilityRegistration: lsProtocol.Registration) => {
            this.serverCapabilities = registerServerCapability(this.serverCapabilities, capabilityRegistration);
          });
          
          this.emit('changedServerCapabilities');

          this.emit('logging', params);
        });

        this.connection.onRequest('client/unregisterCapability', (params: lsProtocol.UnregistrationParams) => {
          params.unregisterations.forEach((capabilityUnregistration: lsProtocol.Unregistration) => {
            this.serverCapabilities = unregisterServerCapability(this.serverCapabilities, capabilityUnregistration);
          });
          
          this.emit('changedServerCapabilities');

          this.emit('logging', params);
        });

        this.connection.onRequest('window/showMessageRequest', (params: lsProtocol.ShowMessageRequestParams) => {
          this.emit('logging', params);
        });

        this.connection.onError((e) => {
          this.emit('error', e);
        });

        this.connection.onClose(() => {
          this.isConnected = false;
        });
      },
    });

    return this;
  }

  public sendInitialize() {
    if (!this.isConnected) {
      return;
    }

    const message: lsProtocol.InitializeParams = {
      capabilities: {
        textDocument: {
          hover: {
            dynamicRegistration: true,
            contentFormat: ['plaintext', 'markdown'],
          },
          synchronization: {
            dynamicRegistration: true,
            willSave: false,
            didSave: false,
            willSaveWaitUntil: false,
          },
          completion: {
            dynamicRegistration: true,
            completionItem: {
              snippetSupport: false,
              commitCharactersSupport: true,
              documentationFormat: ['plaintext', 'markdown'],
              deprecatedSupport: false,
              preselectSupport: false,
            },
            contextSupport: true,
          },
          signatureHelp: {
            dynamicRegistration: true,
            signatureInformation: {
              documentationFormat: ['plaintext', 'markdown'],
            },
          },
          declaration: {
            dynamicRegistration: true,
            linkSupport: true,
          },
          definition: {
            dynamicRegistration: true,
            linkSupport: true,
          },
          references: {
            dynamicRegistration: true,
          },
          typeDefinition: {
            dynamicRegistration: true,
            linkSupport: true,
          },
          implementation: {
            dynamicRegistration: true,
            linkSupport: true,
          },
        } as ExtendedClientCapabilities,
        workspace: {
          didChangeConfiguration: {
            dynamicRegistration: true,
          },
        } as lsProtocol.WorkspaceClientCapabilities,
        // xfilesProvider: true,
        // xcontentProvider: true,
      } as lsProtocol.ClientCapabilities,
      initializationOptions: null,
      processId: null,
      rootUri: this.documentInfo.rootUri,
      workspaceFolders: null,
    };

    this.connection.sendRequest('initialize', message).then((params: lsProtocol.InitializeResult) => {
      this.isInitialized = true;
      this.serverCapabilities = params.capabilities as ServerCapabilities;
      this.connection.sendNotification('initialized');
      this.connection.sendNotification('workspace/didChangeConfiguration', {
        settings: {},
      });
      this.emit('initialized');
    }, (e) => {
    });
  }
}

export default LspWsConnectionManager;

