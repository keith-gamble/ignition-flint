import * as vscode from 'vscode';

export class SubscriptionManager {
  private subscriptions: vscode.Disposable[] = [];

  public add(subscription: vscode.Disposable) {
    this.subscriptions.push(subscription);
  }

  public dispose() {
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.subscriptions = [];
  }
}