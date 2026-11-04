using Farol.Contrato;

namespace Farol.Tests;

/// <summary>
/// A prova do pareamento: o token só vale quando o fluxo novo entrega o primeiro retrato
/// <c>casca</c>. Recusa do token guardado gasta o código uma vez; o resto é falha.
/// </summary>
public class PairingProofTests
{
    [Fact]
    public void FirstShellProvesTheToken()
    {
        var proof = new PairingProof(tokenFromStore: true);

        Assert.Equal(ProofStep.Proven, proof.OnShell());
        Assert.True(proof.Settled);
    }

    [Fact]
    public void StoredTokenRefusedRetriesWithTheCodeOnce()
    {
        var proof = new PairingProof(tokenFromStore: true);

        Assert.Equal(ProofStep.PairWithCode, proof.OnUnauthorized());
        Assert.False(proof.Settled);
        proof.OnPairedWithCode();
        Assert.Equal(ProofStep.Failed, proof.OnUnauthorized());
        Assert.True(proof.Settled);
    }

    [Fact]
    public void RetriedTokenCanStillBeProven()
    {
        var proof = new PairingProof(tokenFromStore: true);
        proof.OnUnauthorized();
        proof.OnPairedWithCode();

        Assert.Equal(ProofStep.Proven, proof.OnShell());
    }

    [Fact]
    public void FreshTokenRefusedFailsWithoutRetry()
    {
        var proof = new PairingProof(tokenFromStore: false);

        Assert.Equal(ProofStep.Failed, proof.OnUnauthorized());
    }

    [Fact]
    public void TimeoutFails()
    {
        var proof = new PairingProof(tokenFromStore: true);

        Assert.Equal(ProofStep.Failed, proof.OnTimeout());
        Assert.True(proof.Settled);
    }

    [Fact]
    public void AfterSettlingEverythingIsIgnored()
    {
        var proof = new PairingProof(tokenFromStore: true);
        proof.OnShell();

        Assert.Equal(ProofStep.None, proof.OnShell());
        Assert.Equal(ProofStep.None, proof.OnUnauthorized());
        Assert.Equal(ProofStep.None, proof.OnTimeout());
    }

    [Fact]
    public void AbandonedProofIgnoresEverything()
    {
        var proof = new PairingProof(tokenFromStore: true);
        proof.Abandon();

        Assert.True(proof.Settled);
        Assert.Equal(ProofStep.None, proof.OnShell());
        Assert.Equal(ProofStep.None, proof.OnTimeout());
    }

    [Fact]
    public void TheWaitIsBounded()
    {
        Assert.Equal(TimeSpan.FromSeconds(15), PairingProof.Timeout);
    }
}
